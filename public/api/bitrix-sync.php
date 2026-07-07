<?php

const BITRIX_DEFAULT_SYNC_INTERVAL_SECONDS = 300;
const BITRIX_SYNC_LOCK_SECONDS = 60;

function maybe_sync_bitrix_deals()
{
    if (!bitrix_config('BITRIX_WEBHOOK_URL', '')) return;
    if (!bitrix_auto_sync_on_read()) return;

    try {
        sync_bitrix_deals(false);
    } catch (Exception $error) {
        error_log('Bitrix sync failed: ' . $error->getMessage());
    }
}

function sync_bitrix_deals($force = false)
{
    if (!bitrix_config('BITRIX_WEBHOOK_URL', '')) {
        return ['success' => false, 'skipped' => true, 'reason' => 'BITRIX_WEBHOOK_URL is not configured'];
    }

    if (!$force && !bitrix_deals_sync_is_due()) {
        $current = read_data_file_raw('deals.json');
        return [
            'success' => true,
            'skipped' => true,
            'reason' => 'fresh',
            'count' => count(array_get($current, 'items', [])),
            'generatedAt' => array_get($current, 'generatedAt', ''),
            'data' => $current,
        ];
    }

    global $dataDir;
    $lockPath = $dataDir . DIRECTORY_SEPARATOR . 'deals-sync.lock';
    $lock = fopen($lockPath, 'c');
    if (!$lock) throw new RuntimeException('Cannot open Bitrix sync lock');

    try {
        if (!flock($lock, LOCK_EX | LOCK_NB)) {
            $current = read_data_file_raw('deals.json');
            return [
                'success' => true,
                'skipped' => true,
                'reason' => 'locked',
                'count' => count(array_get($current, 'items', [])),
                'data' => $current,
            ];
        }

        if (!$force && !bitrix_deals_sync_is_due()) {
            $current = read_data_file_raw('deals.json');
            return [
                'success' => true,
                'skipped' => true,
                'reason' => 'fresh_after_lock',
                'count' => count(array_get($current, 'items', [])),
                'generatedAt' => array_get($current, 'generatedAt', ''),
                'data' => $current,
            ];
        }

        $data = fetch_bitrix_deals_payload();
        write_data_file('deals.json', $data);

        return [
            'success' => true,
            'skipped' => false,
            'count' => count(array_get($data, 'items', [])),
            'generatedAt' => array_get($data, 'generatedAt', ''),
            'data' => $data,
        ];
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function bitrix_auto_sync_on_read()
{
    $value = strtolower(trim((string)bitrix_config('BITRIX_AUTO_SYNC_ON_READ', '0')));
    return in_array($value, ['1', 'true', 'yes', 'on'], true);
}

function sync_bitrix_deal($dealId)
{
    $id = trim((string)$dealId);
    if ($id === '') {
        return ['success' => true, 'skipped' => true, 'reason' => 'missing_deal_id'];
    }

    if (!bitrix_config('BITRIX_WEBHOOK_URL', '')) {
        return ['success' => false, 'skipped' => true, 'reason' => 'BITRIX_WEBHOOK_URL is not configured'];
    }

    $response = call_bitrix_rest('crm.deal.get', [
        'id' => $id,
    ]);
    $deal = array_get($response, 'result', []);
    if (!is_array($deal) || count($deal) === 0) {
        return remove_bitrix_deal_from_cache($id);
    }

    $targetStageItems = bitrix_target_stage_items();
    $targetStageIds = [];
    $stageCodesById = [];
    foreach ($targetStageItems as $stage) {
        $stageId = (string)array_get($stage, 'id', '');
        if ($stageId === '') continue;
        $targetStageIds[$stageId] = true;
        $stageCodesById[$stageId] = (string)array_get($stage, 'code', '');
    }

    $stageId = (string)array_get($deal, 'STAGE_ID', '');
    if ($stageId !== '' && count($targetStageIds) > 0 && !isset($targetStageIds[$stageId])) {
        return remove_bitrix_deal_from_cache($id);
    }

    $dictionaries = [
        'stageMap' => load_bitrix_stage_map(),
        'sourceMap' => load_bitrix_status_map('SOURCE'),
        'typeMap' => load_bitrix_status_map('DEAL_TYPE'),
        'customFieldMaps' => load_bitrix_custom_field_maps(),
        'customFieldLabels' => load_bitrix_custom_field_labels(),
    ];

    $responsibleId = trim((string)array_get($deal, 'ASSIGNED_BY_ID', ''));
    $users = $responsibleId !== '' ? fetch_bitrix_users([$responsibleId]) : [];
    $normalized = normalize_bitrix_deal($deal, $users, $dictionaries, $stageCodesById);

    $data = read_data_file_raw('deals.json');
    $items = array_get($data, 'items', []);
    if (!is_array($items)) $items = [];

    $nextItems = [];
    $inserted = false;
    foreach ($items as $item) {
        if ((string)array_get($item, 'id', '') === $id) {
            $nextItems[] = $normalized;
            $inserted = true;
        } else {
            $nextItems[] = $item;
        }
    }
    if (!$inserted) array_unshift($nextItems, $normalized);

    $data['generatedAt'] = gmdate('c');
    $data['stages'] = $targetStageItems;
    $data['items'] = $nextItems;
    write_data_file('deals.json', $data);

    return [
        'success' => true,
        'skipped' => false,
        'action' => $inserted ? 'updated' : 'added',
        'dealId' => $id,
        'data' => $data,
    ];
}

function remove_bitrix_deal_from_cache($dealId)
{
    $id = trim((string)$dealId);
    if ($id === '') {
        return ['success' => true, 'skipped' => true, 'reason' => 'missing_deal_id'];
    }

    $data = read_data_file_raw('deals.json');
    $items = array_get($data, 'items', []);
    if (!is_array($items)) $items = [];

    $before = count($items);
    $items = array_values(array_filter($items, function ($item) use ($id) {
        return (string)array_get($item, 'id', '') !== $id;
    }));

    $data['generatedAt'] = gmdate('c');
    $data['items'] = $items;
    if (!isset($data['stages']) || !is_array($data['stages'])) $data['stages'] = bitrix_target_stage_items();
    write_data_file('deals.json', $data);

    return [
        'success' => true,
        'skipped' => false,
        'action' => $before === count($items) ? 'not_found' : 'removed',
        'dealId' => $id,
        'data' => $data,
    ];
}

function bitrix_request_event_name()
{
    $payloads = [$_POST, $_GET, request_json_if_possible()];
    foreach ($payloads as $payload) {
        $event = first_text(
            array_get($payload, 'event', ''),
            array_get($payload, 'EVENT', ''),
            array_get($payload, 'eventName', '')
        );
        if ($event !== '') return $event;
    }
    return '';
}

function bitrix_request_deal_id()
{
    $payloads = [$_POST, $_GET, request_json_if_possible()];
    foreach ($payloads as $payload) {
        $id = bitrix_extract_deal_id($payload);
        if ($id !== '') return $id;
    }
    return '';
}

function bitrix_extract_deal_id($value)
{
    if (is_array($value)) {
        foreach (['dealId', 'deal_id', 'DEAL_ID', 'ID'] as $key) {
            $candidate = trim((string)array_get($value, $key, ''));
            if ($candidate !== '' && preg_match('/^\d+$/', $candidate)) return $candidate;
        }

        foreach ($value as $key => $item) {
            if (is_string($key) && preg_match('/deal/i', $key)) {
                $candidate = bitrix_extract_deal_id($item);
                if ($candidate !== '') return $candidate;
            }
        }

        foreach ($value as $item) {
            $candidate = bitrix_extract_deal_id($item);
            if ($candidate !== '') return $candidate;
        }
    }

    if (is_string($value)) {
        if (preg_match('/DEAL_(\d+)/i', $value, $match)) return $match[1];
        if (preg_match('#/crm/deal/details/(\d+)/#i', $value, $match)) return $match[1];
    }

    return '';
}

function require_bitrix_sync_token()
{
    $token = trim((string)bitrix_config('BITRIX_SYNC_TOKEN', ''));
    if ($token === '') return;

    $provided = trim((string)first_defined(
        array_get($_GET, 'token', ''),
        array_get($_SERVER, 'HTTP_X_SYNC_TOKEN', ''),
        array_get(request_json_if_possible(), 'token', '')
    ));

    if (!hash_equals($token, $provided)) {
        json_response(['success' => false, 'error' => 'Forbidden'], 403);
    }
}

function request_json_if_possible()
{
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') return [];
    $json = json_decode($raw, true);
    return is_array($json) ? $json : [];
}

function bitrix_deals_sync_is_due()
{
    $current = read_data_file_raw('deals.json');
    $items = array_get($current, 'items', []);
    if (!is_array($items) || count($items) === 0) return true;

    $generatedAt = strtotime((string)array_get($current, 'generatedAt', ''));
    if (!$generatedAt) return true;

    $interval = (int)bitrix_config('BITRIX_SYNC_INTERVAL_SECONDS', BITRIX_DEFAULT_SYNC_INTERVAL_SECONDS);
    $interval = max(10, $interval);
    return (time() - $generatedAt) >= $interval;
}

function fetch_bitrix_deals_payload()
{
    $stageCodesById = [];
    $targetStageItems = bitrix_target_stage_items();
    foreach ($targetStageItems as $stage) {
        $stageId = (string)array_get($stage, 'id', '');
        $code = (string)array_get($stage, 'code', '');
        if ($stageId !== '' && $code !== '') $stageCodesById[$stageId] = $code;
    }

    $dictionaries = [
        'stageMap' => load_bitrix_stage_map(),
        'sourceMap' => load_bitrix_status_map('SOURCE'),
        'typeMap' => load_bitrix_status_map('DEAL_TYPE'),
        'customFieldMaps' => load_bitrix_custom_field_maps(),
        'customFieldLabels' => load_bitrix_custom_field_labels(),
    ];

    $deals = fetch_bitrix_deals(array_map(function ($stage) {
        return (string)array_get($stage, 'id', '');
    }, $targetStageItems));
    $responsibleIds = [];
    foreach ($deals as $deal) {
        $id = trim((string)array_get($deal, 'ASSIGNED_BY_ID', ''));
        if ($id !== '') $responsibleIds[$id] = true;
    }
    $users = fetch_bitrix_users(array_keys($responsibleIds));

    $items = [];
    foreach ($deals as $deal) {
        $items[] = normalize_bitrix_deal($deal, $users, $dictionaries, $stageCodesById);
    }

    return [
        'generatedAt' => gmdate('c'),
        'stages' => $targetStageItems,
        'items' => $items,
    ];
}

function bitrix_target_stages()
{
    $stages = [];
    foreach (bitrix_target_stage_items() as $stage) {
        $id = (string)array_get($stage, 'id', '');
        $code = (string)array_get($stage, 'code', '');
        if ($id !== '' && $code !== '') $stages[$id] = $code;
    }
    return $stages;
}

function bitrix_legacy_target_stages()
{
    $stages = [
        (string)bitrix_config('BITRIX_TZ_STAGE_ID', 'DETAILS') => 'tz',
        (string)bitrix_config('BITRIX_TZ_APPROVAL_STAGE_ID', '13') => 'tzApproval',
        (string)bitrix_config('BITRIX_LAUNCH_STAGE_ID', bitrix_config('BITRIX_STAGE_ID', '4')) => 'launch',
        (string)bitrix_config('BITRIX_PRODUCTION_STAGE_ID', '10') => 'production',
        (string)bitrix_config('BITRIX_DEFECT_STAGE_ID', '9') => 'defect',
    ];

    return array_filter($stages, function ($code, $stageId) {
        return $stageId !== '' && $code !== '';
    }, ARRAY_FILTER_USE_BOTH);
}

function bitrix_target_stage_items()
{
    $items = load_bitrix_stage_items();
    if (!$items) {
        $fallbackNames = [
            'tz' => 'Подготовка ТЗ',
            'tzApproval' => 'Согласование ТЗ',
            'launch' => 'Готово к отгрузке',
            'production' => 'На сборке',
            'defect' => 'Косяк',
        ];
        $fallback = [];
        $sort = 10;
        foreach (bitrix_legacy_target_stages() as $id => $code) {
            $fallback[] = [
                'id' => (string)$id,
                'name' => array_get($fallbackNames, $code, (string)$id),
                'code' => $code,
                'sort' => $sort,
                'categoryId' => '',
                'entityId' => 'DEAL_STAGE',
            ];
            $sort += 10;
        }
        return $fallback;
    }

    $configuredCategoryId = trim((string)bitrix_config('BITRIX_CATEGORY_ID', ''));
    if ($configuredCategoryId !== '') {
        $items = array_values(array_filter($items, function ($stage) use ($configuredCategoryId) {
            return bitrix_stage_matches_category($stage, $configuredCategoryId);
        }));
    } else {
        $items = array_values(array_filter($items, function ($stage) {
            return bitrix_stage_matches_category($stage, '');
        }));
    }

    $startId = trim((string)bitrix_config('BITRIX_TZ_STAGE_ID', 'DETAILS'));
    $startName = normalize_bitrix_text((string)bitrix_config('BITRIX_TZ_STAGE_NAME', 'Подготовка ТЗ'));
    $groups = [];
    foreach ($items as $stage) {
        $categoryId = (string)array_get($stage, 'categoryId', '');
        if (!isset($groups[$categoryId])) $groups[$categoryId] = [];
        $groups[$categoryId][] = $stage;
    }

    $target = [];
    foreach ($groups as $group) {
        usort($group, function ($a, $b) {
            $left = (int)array_get($a, 'sort', 999999);
            $right = (int)array_get($b, 'sort', 999999);
            if ($left !== $right) return $left - $right;
            return strcmp((string)array_get($a, 'name', ''), (string)array_get($b, 'name', ''));
        });

        $startSort = null;
        foreach ($group as $stage) {
            $id = (string)array_get($stage, 'id', '');
            $name = normalize_bitrix_text((string)array_get($stage, 'name', ''));
            if (($startId !== '' && $id === $startId) || ($startName !== '' && strpos($name, $startName) !== false)) {
                $startSort = (int)array_get($stage, 'sort', 0);
                break;
            }
        }

        foreach ($group as $stage) {
            if ($startSort !== null && (int)array_get($stage, 'sort', 0) < $startSort) continue;
            $target[] = $stage;
        }
    }

    return $target ?: $items;
}

function bitrix_stage_matches_category($stage, $categoryId)
{
    $expected = trim((string)$categoryId);
    $actual = trim((string)array_get($stage, 'categoryId', ''));
    $entityId = (string)array_get($stage, 'entityId', '');

    if ($expected === '' || $expected === '0') {
        return ($actual === '' || $actual === '0') && $entityId === 'DEAL_STAGE';
    }

    return $actual === $expected;
}

function fetch_bitrix_deals($stageIds)
{
    $seen = [];
    $all = [];
    foreach ($stageIds as $stageId) {
        $start = 0;
        do {
            $filter = ['STAGE_ID' => $stageId];
            $categoryId = trim((string)bitrix_config('BITRIX_CATEGORY_ID', ''));
            if ($categoryId !== '') $filter['CATEGORY_ID'] = $categoryId;

            $response = call_bitrix_rest('crm.deal.list', [
                'order' => ['DATE_MODIFY' => 'DESC'],
                'filter' => $filter,
                'select' => bitrix_deal_select_fields(),
                'start' => $start,
            ]);

            foreach (array_get($response, 'result', []) as $deal) {
                $id = (string)array_get($deal, 'ID', '');
                if ($id === '' || isset($seen[$id])) continue;
                $seen[$id] = true;
                $all[] = $deal;
            }

            $start = array_key_exists('next', $response) ? $response['next'] : null;
        } while ($start !== null && $start !== '');
    }

    usort($all, function ($first, $second) {
        return strcmp((string)array_get($second, 'DATE_MODIFY', ''), (string)array_get($first, 'DATE_MODIFY', ''));
    });

    return $all;
}

function bitrix_deal_select_fields()
{
    $fields = [
        'ID',
        'TITLE',
        'STAGE_ID',
        'CATEGORY_ID',
        'SOURCE_ID',
        'TYPE_ID',
        'OPPORTUNITY',
        'ASSIGNED_BY_ID',
        'BEGINDATE',
        'CLOSEDATE',
        'DATE_CREATE',
        'DATE_MODIFY',
        'UF_*',
    ];

    foreach (bitrix_live_field_names() as $fieldName) {
        if ($fieldName && !in_array($fieldName, $fields, true)) $fields[] = $fieldName;
    }

    return $fields;
}

function fetch_bitrix_users($ids)
{
    $users = [];
    foreach ($ids as $id) {
        try {
            $response = call_bitrix_rest('user.get', ['ID' => $id]);
            $result = array_get($response, 'result', []);
            $user = is_array($result) && isset($result[0]) && is_array($result[0]) ? $result[0] : null;
            $users[(string)$id] = $user ? normalize_bitrix_user($user, $id) : create_bitrix_responsible_fallback($id);
        } catch (Exception $error) {
            $users[(string)$id] = create_bitrix_responsible_fallback($id);
        }
    }
    return $users;
}

function normalize_bitrix_user($user, $id)
{
    $idText = (string)$id;
    $name = trim(implode(' ', array_filter([
        array_get($user, 'LAST_NAME', ''),
        array_get($user, 'NAME', ''),
        array_get($user, 'SECOND_NAME', ''),
    ])));

    return [
        'id' => $idText,
        'name' => $name !== '' ? $name : $idText,
        'phone' => extract_bitrix_user_phone($user),
        'internalPhone' => extract_bitrix_user_internal_phone($user),
        'email' => first_text(array_get($user, 'EMAIL', ''), array_get($user, 'WORK_EMAIL', ''), array_get($user, 'PERSONAL_EMAIL', '')),
        'position' => first_text(array_get($user, 'WORK_POSITION', ''), array_get($user, 'UF_POSITION', ''), array_get($user, 'PERSONAL_PROFESSION', '')),
        'department' => first_text(array_get($user, 'WORK_DEPARTMENT', '')),
        'supervisor' => normalize_bitrix_supervisor(array_get($user, 'UF_HEAD', '')),
        'avatarUrl' => extract_bitrix_user_photo($user),
        'bitrixUrl' => bitrix_user_url($idText),
        'chatUrl' => bitrix_chat_url($idText),
        'videoUrl' => bitrix_chat_url($idText),
        'lastSeenAt' => normalize_bitrix_date(first_text(
            array_get($user, 'LAST_ACTIVITY_DATE', ''),
            array_get($user, 'LAST_ACTIVITY', ''),
            array_get($user, 'LAST_LOGIN', ''),
            array_get($user, 'TIMESTAMP_X', '')
        )),
    ];
}

function create_bitrix_responsible_fallback($id)
{
    $idText = (string)$id;
    return [
        'id' => $idText,
        'name' => $idText,
        'phone' => '',
        'bitrixUrl' => $idText !== '' ? bitrix_user_url($idText) : '',
        'chatUrl' => $idText !== '' ? bitrix_chat_url($idText) : '',
        'videoUrl' => $idText !== '' ? bitrix_chat_url($idText) : '',
    ];
}

function normalize_bitrix_deal($deal, $users, $dictionaries, $stageCodesById)
{
    $id = (string)array_get($deal, 'ID', '');
    $fields = bitrix_live_field_names();
    $stageId = (string)array_get($deal, 'STAGE_ID', '');
    $stageName = array_get($dictionaries['stageMap'], $stageId, $stageId);
    $totalSaleAmount = to_number(array_get($deal, 'OPPORTUNITY', 0));
    $installSaleAmount = to_number(value_by_field($deal, $fields['installAmount']));
    $productionSaleAmount = $installSaleAmount > 0 ? max(0, $totalSaleAmount - $installSaleAmount) : $totalSaleAmount;
    $responsibleId = (string)array_get($deal, 'ASSIGNED_BY_ID', '');
    $responsibleUser = array_get($users, $responsibleId, null);
    $bitrixDomain = bitrix_domain();

    $installationAddress = value_by_field($deal, $fields['installAddress']) ?: infer_deal_text_field($deal, [
        'INSTALL_ADDRESS',
        'INSTALLATION_ADDRESS',
        'MOUNT_ADDRESS',
        'MOUNTING_ADDRESS',
        'ADDRESS',
    ]);
    $installationClientName = value_by_field($deal, $fields['installClientName']) ?: infer_deal_text_field($deal, [
        'INSTALL_CLIENT',
        'INSTALLATION_CLIENT',
        'CLIENT_NAME',
        'CUSTOMER',
    ]);
    $installationClientPhone = value_by_field($deal, $fields['installClientPhone']) ?: infer_deal_phone_field($deal);
    $installationComment = value_by_field($deal, $fields['installComment']) ?: infer_deal_text_field($deal, [
        'INSTALL_COMMENT',
        'INSTALLATION_COMMENT',
        'MOUNT_COMMENT',
        'COMMENT',
    ]);
    $fileSource = $fields['installFiles'] ? array_get($deal, $fields['installFiles'], null) : infer_deal_file_field($deal);
    $techSpecFileField = $fields['techSpecFiles'] ?: infer_deal_tech_spec_file_field($deal, array_get($dictionaries, 'customFieldLabels', []));
    $techSpecFileSource = $techSpecFileField !== '' ? array_get($deal, $techSpecFileField, null) : infer_deal_file_field($deal);
    $installationFiles = tag_bitrix_deal_files(extract_bitrix_deal_files($fileSource, $bitrixDomain), 'installation', $fields['installFiles']);
    $techSpecFiles = tag_bitrix_deal_files(extract_bitrix_deal_files($techSpecFileSource, $bitrixDomain), 'techSpec', $techSpecFileField);

    return [
        'id' => $id,
        'number' => $id,
        'title' => (string)array_get($deal, 'TITLE', ''),
        'stageId' => $stageId,
        'stageCode' => array_get($stageCodesById, $stageId, infer_bitrix_stage_code($stageName)),
        'source' => array_get($dictionaries['sourceMap'], (string)array_get($deal, 'SOURCE_ID', ''), (string)array_get($deal, 'SOURCE_ID', '')),
        'type' => array_get($dictionaries['typeMap'], (string)array_get($deal, 'TYPE_ID', ''), (string)array_get($deal, 'TYPE_ID', '')),
        'classification' => display_value_by_field($deal, $fields['classification'], $dictionaries['customFieldMaps']),
        'saleAmount' => $productionSaleAmount,
        'installSaleAmount' => $installSaleAmount,
        'responsibleId' => $responsibleId,
        'responsible' => is_array($responsibleUser) ? array_get($responsibleUser, 'name', $responsibleId) : $responsibleId,
        'responsiblePhone' => is_array($responsibleUser) ? array_get($responsibleUser, 'phone', '') : '',
        'responsibleCard' => clean_bitrix_responsible_card($responsibleUser ?: ($responsibleId !== '' ? create_bitrix_responsible_fallback($responsibleId) : null)),
        'startDate' => value_by_field($deal, $fields['startDate']) ?: (string)array_get($deal, 'BEGINDATE', ''),
        'expectedFinishDate' => value_by_field($deal, $fields['expectedFinishDate']) ?: (string)array_get($deal, 'CLOSEDATE', ''),
        'createdDate' => (string)array_get($deal, 'DATE_CREATE', ''),
        'stageName' => (string)$stageName,
        'bitrixUrl' => 'https://' . $bitrixDomain . '/crm/deal/details/' . rawurlencode($id) . '/',
        'installationAddress' => (string)$installationAddress,
        'installationClientName' => (string)$installationClientName,
        'installationClientPhone' => (string)$installationClientPhone,
        'installationComment' => (string)$installationComment,
        'installationFiles' => $installationFiles,
        'techSpecFiles' => $techSpecFiles,
    ];
}

function load_bitrix_stage_map()
{
    $stages = [];
    foreach (load_bitrix_stage_items() as $stage) {
        $id = (string)array_get($stage, 'id', '');
        if ($id !== '') $stages[$id] = (string)array_get($stage, 'name', $id);
    }
    return $stages;
}

function load_bitrix_stage_items()
{
    $items = [];
    add_bitrix_stage_items($items, 'DEAL_STAGE', '');

    try {
        $categories = call_bitrix_rest('crm.dealcategory.list', []);
        foreach (array_get($categories, 'result', []) as $category) {
            $categoryId = (string)array_get($category, 'ID', '');
            if ($categoryId === '') continue;
            add_bitrix_stage_items($items, 'DEAL_STAGE_' . $categoryId, $categoryId);
            try {
                $categoryStages = call_bitrix_rest('crm.dealcategory.stage.list', ['id' => $categoryId]);
                foreach (array_get($categoryStages, 'result', []) as $stage) {
                    $id = (string)first_defined(array_get($stage, 'STATUS_ID', ''), array_get($stage, 'ID', ''));
                    if ($id === '') continue;
                    $name = (string)first_defined(array_get($stage, 'NAME', ''), array_get($stage, 'TITLE', ''), $id);
                    $items[$id] = [
                        'id' => $id,
                        'name' => $name,
                        'code' => infer_bitrix_stage_code($name),
                        'sort' => (int)first_defined(array_get($stage, 'SORT', 0), array_get($stage, 'sort', 0), 0),
                        'categoryId' => $categoryId,
                        'entityId' => 'DEAL_STAGE_' . $categoryId,
                    ];
                }
            } catch (Exception $error) {
                // Category stage methods are optional for incoming webhooks.
            }
        }
    } catch (Exception $error) {
        // CRM category methods are optional for incoming webhooks.
    }

    $items = array_filter($items, function ($stage) {
        return is_bitrix_deal_stage_entity((string)array_get($stage, 'entityId', 'DEAL_STAGE'));
    });

    return array_values($items);
}

function is_bitrix_deal_stage_entity($entityId)
{
    $value = (string)$entityId;
    return $value === 'DEAL_STAGE' || preg_match('/^DEAL_STAGE_\d+$/', $value) === 1;
}

function add_bitrix_stage_items(&$items, $entityId, $categoryId = '')
{
    if (!is_bitrix_deal_stage_entity($entityId)) return;

    try {
        $response = call_bitrix_rest('crm.status.list', ['filter' => ['ENTITY_ID' => $entityId]]);
        foreach (array_get($response, 'result', []) as $status) {
            $id = (string)array_get($status, 'STATUS_ID', '');
            if ($id === '') continue;
            $name = (string)array_get($status, 'NAME', $id);
            $items[$id] = [
                'id' => $id,
                'name' => $name,
                'code' => infer_bitrix_stage_code($name),
                'sort' => (int)array_get($status, 'SORT', 0),
                'categoryId' => (string)$categoryId,
                'entityId' => (string)$entityId,
            ];
        }
    } catch (Exception $error) {
        // Missing status methods should not break regular data loading.
    }
}

function load_bitrix_status_map($entityId)
{
    $statuses = [];
    add_bitrix_statuses($statuses, $entityId);
    return $statuses;
}

function add_bitrix_statuses(&$statuses, $entityId)
{
    try {
        $response = call_bitrix_rest('crm.status.list', ['filter' => ['ENTITY_ID' => $entityId]]);
        foreach (array_get($response, 'result', []) as $status) {
            $id = (string)array_get($status, 'STATUS_ID', '');
            if ($id !== '') $statuses[$id] = (string)array_get($status, 'NAME', $id);
        }
    } catch (Exception $error) {
        // Optional dictionaries should not stop deal loading.
    }
}

function bitrix_stage_id_for_target($targetStage, $explicitStageId = '')
{
    $candidate = trim((string)first_defined($explicitStageId, $targetStage));
    if ($candidate === '') {
        throw new RuntimeException('Bitrix stage is required');
    }

    $normalizedCandidate = normalize_bitrix_text($candidate);
    $allStages = load_bitrix_stage_items();
    $targetStages = bitrix_target_stage_items();
    $legacyMap = bitrix_legacy_target_stages();

    foreach ([$targetStages, $allStages] as $stageList) {
        foreach ($stageList as $stage) {
            $id = (string)array_get($stage, 'id', '');
            $code = (string)array_get($stage, 'code', '');
            $name = normalize_bitrix_text((string)array_get($stage, 'name', ''));
            if ($id === $candidate || ($code !== '' && $code === $candidate) || ($name !== '' && $name === $normalizedCandidate)) {
                return $id;
            }
        }
    }

    foreach ($legacyMap as $stageId => $code) {
        if ((string)$stageId === $candidate || (string)$code === $candidate) {
            return (string)$stageId;
        }
    }

    throw new RuntimeException('Unknown Bitrix stage: ' . $candidate);
}

function move_bitrix_deal_stage($dealId, $targetStageId)
{
    $id = trim((string)$dealId);
    $stageId = trim((string)$targetStageId);
    if ($id === '') throw new RuntimeException('Deal id is required');
    if ($stageId === '') throw new RuntimeException('Bitrix stage is required');

    $response = call_bitrix_rest('crm.deal.update', [
        'id' => $id,
        'fields' => [
            'STAGE_ID' => $stageId,
        ],
    ]);

    $syncResult = sync_bitrix_deal($id);
    return [
        'success' => true,
        'bitrix' => $response,
        'data' => read_data_file_raw('deals.json'),
        'sync' => $syncResult,
    ];
}

function load_bitrix_custom_field_maps()
{
    $maps = [];
    try {
        $response = call_bitrix_rest('crm.deal.userfield.list', []);
        foreach (array_get($response, 'result', []) as $field) {
            $fieldName = (string)array_get($field, 'FIELD_NAME', '');
            $list = array_get($field, 'LIST', []);
            if ($fieldName === '' || !is_array($list)) continue;
            $map = [];
            foreach ($list as $item) {
                $id = (string)array_get($item, 'ID', '');
                if ($id !== '') $map[$id] = (string)first_defined(array_get($item, 'VALUE', ''), $id);
            }
            $maps[$fieldName] = $map;
        }
    } catch (Exception $error) {
        // Enumeration decoding is helpful, but not required.
    }
    return $maps;
}

function load_bitrix_custom_field_labels()
{
    $labels = [];
    try {
        $response = call_bitrix_rest('crm.deal.userfield.list', []);
        foreach (array_get($response, 'result', []) as $field) {
            $fieldName = (string)array_get($field, 'FIELD_NAME', '');
            if ($fieldName === '') continue;
            $label = first_text(
                array_get($field, 'EDIT_FORM_LABEL', ''),
                array_get($field, 'LIST_COLUMN_LABEL', ''),
                array_get($field, 'LIST_FILTER_LABEL', ''),
                array_get($field, 'USER_TYPE_ID', '')
            );
            if ($label !== '') $labels[$fieldName] = $label;
        }
    } catch (Exception $error) {
        // Field labels only improve automatic file discovery.
    }
    return $labels;
}

function call_bitrix_rest($method, $params)
{
    $webhookUrl = rtrim((string)bitrix_config('BITRIX_WEBHOOK_URL', ''), '/') . '/';
    if ($webhookUrl === '/') throw new RuntimeException('BITRIX_WEBHOOK_URL is not configured');

    $url = $webhookUrl . $method . '.json';
    $payload = json_encode($params, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $raw = '';
    $status = 0;

    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => $payload,
        ]);
        $raw = curl_exec($curl);
        $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $error = curl_error($curl);
        curl_close($curl);
        if ($raw === false || $raw === '') throw new RuntimeException($method . ' failed: ' . ($error ?: 'empty response'));
    } else {
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => $payload,
                'ignore_errors' => true,
                'timeout' => 20,
            ],
        ]);
        $raw = @file_get_contents($url, false, $context);
        $status = bitrix_http_status_from_headers(isset($http_response_header) ? $http_response_header : []);
        if ($raw === false || $raw === '') throw new RuntimeException($method . ' failed: empty response');
    }

    if ($status >= 400) throw new RuntimeException($method . ' failed: HTTP ' . $status . ' ' . substr((string)$raw, 0, 300));

    $json = json_decode((string)$raw, true);
    if (!is_array($json)) throw new RuntimeException($method . ' failed: invalid JSON');
    if (isset($json['error'])) {
        throw new RuntimeException($method . ' failed: ' . first_defined(array_get($json, 'error_description', ''), array_get($json, 'error', '')));
    }
    return $json;
}

function bitrix_http_status_from_headers($headers)
{
    foreach ($headers as $header) {
        if (preg_match('#^HTTP/\S+\s+(\d+)#', (string)$header, $match)) return (int)$match[1];
    }
    return 0;
}

function bitrix_live_field_names()
{
    return [
        'classification' => (string)bitrix_config('BITRIX_FIELD_CLASSIFICATION', 'UF_CRM_6512B7A78D965'),
        'installAmount' => (string)bitrix_config('BITRIX_FIELD_INSTALL_AMOUNT', 'UF_CRM_1547662428256'),
        'installAddress' => (string)bitrix_config('BITRIX_FIELD_INSTALL_ADDRESS', ''),
        'installClientName' => (string)bitrix_config('BITRIX_FIELD_INSTALL_CLIENT_NAME', ''),
        'installClientPhone' => (string)bitrix_config('BITRIX_FIELD_INSTALL_CLIENT_PHONE', ''),
        'installComment' => (string)bitrix_config('BITRIX_FIELD_INSTALL_COMMENT', ''),
        'installFiles' => (string)bitrix_config('BITRIX_FIELD_INSTALL_FILES', ''),
        'techSpecFiles' => (string)bitrix_config('BITRIX_FIELD_TECH_SPEC_FILES', bitrix_config('BITRIX_FIELD_TZ_FILES', '')),
        'startDate' => (string)bitrix_config('BITRIX_FIELD_START_DATE', ''),
        'expectedFinishDate' => (string)bitrix_config('BITRIX_FIELD_EXPECTED_FINISH_DATE', ''),
    ];
}

function value_by_field($row, $fieldName)
{
    if (!$fieldName || !is_array($row) || !array_key_exists($fieldName, $row)) return '';
    return first_text($row[$fieldName]);
}

function display_value_by_field($row, $fieldName, $maps)
{
    if (!$fieldName || !is_array($row) || !array_key_exists($fieldName, $row)) return '';
    $value = $row[$fieldName];
    $map = is_array(array_get($maps, $fieldName, null)) ? $maps[$fieldName] : [];
    $values = is_array($value) ? $value : [$value];
    $display = [];
    foreach ($values as $item) {
        $text = first_text($item);
        if ($text === '') continue;
        $display[] = array_get($map, $text, $text);
    }
    return implode(', ', array_values(array_unique($display)));
}

function infer_deal_text_field($deal, $needles)
{
    $normalizedNeedles = array_map('normalize_bitrix_text', $needles);
    foreach ($deal as $field => $value) {
        $normalizedField = normalize_bitrix_text($field);
        $matched = false;
        foreach ($normalizedNeedles as $needle) {
            if ($needle !== '' && strpos($normalizedField, $needle) !== false) {
                $matched = true;
                break;
            }
        }
        if (!$matched) continue;
        if (preg_match('/FILE|PHOTO|IMAGE|ATTACH/i', (string)$field)) continue;
        $text = first_text($value);
        if ($text !== '' && !preg_match('/^\d+$/', $text)) return $text;
    }
    return '';
}

function infer_deal_phone_field($deal)
{
    foreach ($deal as $field => $value) {
        if (!preg_match('/PHONE|TEL|MOBILE/i', (string)$field)) continue;
        $phone = extract_phone_value($value, true);
        if ($phone !== '') return $phone;
    }
    return '';
}

function infer_deal_file_field($deal)
{
    foreach ($deal as $field => $value) {
        if (!preg_match('/FILE|PHOTO|IMAGE|ATTACH/i', (string)$field)) continue;
        if (count(extract_bitrix_deal_files($value, bitrix_domain())) > 0) return $value;
    }
    return null;
}

function infer_deal_tech_spec_file_field($deal, $labels = [])
{
    $keywords = [
        'TZ',
        'TECHSPEC',
        'TECH_SPEC',
        'SPEC',
        'ТЗ',
        'ТЕХЗАДАН',
        'ТЕХНИЧЕСК',
        'ЗАДАН',
        'МАКЕТ',
    ];

    foreach ($deal as $field => $value) {
        if (count(extract_bitrix_deal_files($value, bitrix_domain())) <= 0) continue;

        $haystack = normalize_bitrix_text((string)$field . ' ' . (string)array_get($labels, (string)$field, ''));
        foreach ($keywords as $keyword) {
            if ($keyword !== '' && strpos($haystack, normalize_bitrix_text($keyword)) !== false) {
                return (string)$field;
            }
        }
    }

    return '';
}

function extract_bitrix_deal_files($value, $bitrixDomain)
{
    $files = [];
    collect_bitrix_deal_files($value, $files, $bitrixDomain);
    return $files;
}

function tag_bitrix_deal_files($files, $source, $field = '')
{
    $tagged = [];
    foreach ($files as $file) {
        if (!is_array($file)) continue;
        $file['source'] = $source;
        if ($field !== '') $file['field'] = (string)$field;
        $tagged[] = $file;
    }
    return $tagged;
}

function collect_bitrix_deal_files($value, &$files, $bitrixDomain)
{
    if (!$value) return;
    if (is_array($value) && array_keys($value) === range(0, count($value) - 1)) {
        foreach ($value as $item) collect_bitrix_deal_files($item, $files, $bitrixDomain);
        return;
    }

    if (is_array($value)) {
        $url = first_text(
            array_get($value, 'URL', ''),
            array_get($value, 'SRC', ''),
            array_get($value, 'DOWNLOAD_URL', ''),
            array_get($value, 'downloadUrl', ''),
            array_get($value, 'url', '')
        );
        $id = first_text(array_get($value, 'ID', ''), array_get($value, 'id', ''), array_get($value, 'FILE_ID', ''), array_get($value, 'fileId', ''));
        $name = first_text(
            array_get($value, 'ORIGINAL_NAME', ''),
            array_get($value, 'FILE_NAME', ''),
            array_get($value, 'NAME', ''),
            array_get($value, 'TITLE', ''),
            array_get($value, 'name', '')
        );
        if ($url !== '') {
            $absoluteUrl = absolute_bitrix_file_url($url, $bitrixDomain);
            $fileName = $name !== '' ? $name : ('File ' . ($id !== '' ? $id : (count($files) + 1)));
            $files[] = [
                'id' => $id !== '' ? (string)$id : (string)(count($files) + 1),
                'name' => $fileName,
                'url' => $absoluteUrl,
                'downloadUrl' => $absoluteUrl,
                'type' => preg_match('/\.(png|jpe?g|webp|gif)$/i', $fileName) || preg_match('/image/i', first_text(array_get($value, 'CONTENT_TYPE', ''), array_get($value, 'type', ''))) ? 'image' : 'file',
            ];
            return;
        }

        foreach ($value as $item) collect_bitrix_deal_files($item, $files, $bitrixDomain);
        return;
    }

    $text = trim((string)$value);
    if (preg_match('#^https?://#i', $text) || strpos($text, '/') === 0) {
        $absoluteUrl = absolute_bitrix_file_url($text, $bitrixDomain);
        $name = basename(parse_url($absoluteUrl, PHP_URL_PATH) ?: ('file-' . (count($files) + 1)));
        $files[] = [
            'id' => (string)(count($files) + 1),
            'name' => rawurldecode($name),
            'url' => $absoluteUrl,
            'downloadUrl' => $absoluteUrl,
            'type' => preg_match('/\.(png|jpe?g|webp|gif)$/i', $name) ? 'image' : 'file',
        ];
    }
}

function clean_bitrix_responsible_card($user)
{
    return is_array($user) ? $user : null;
}

function bitrix_user_url($id)
{
    return 'https://' . bitrix_domain() . '/company/personal/user/' . rawurlencode((string)$id) . '/';
}

function bitrix_chat_url($id)
{
    return 'https://' . bitrix_domain() . '/online/?IM_DIALOG=U' . rawurlencode((string)$id);
}

function bitrix_domain()
{
    $domain = trim((string)bitrix_config('BITRIX_DOMAIN', ''));
    if ($domain !== '') return $domain;
    $webhook = trim((string)bitrix_config('BITRIX_WEBHOOK_URL', ''));
    if ($webhook !== '') {
        $host = parse_url($webhook, PHP_URL_HOST);
        if ($host) return $host;
    }
    return 'verkup.bitrix24.ru';
}

function absolute_bitrix_file_url($value, $bitrixDomain)
{
    $url = trim((string)$value);
    if ($url === '') return '';
    if (preg_match('#^https?://#i', $url)) return $url;
    if (strpos($url, '/') === 0) return 'https://' . $bitrixDomain . $url;
    return $url;
}

function infer_bitrix_stage_code($stageTitle)
{
    $normalized = normalize_bitrix_text($stageTitle);
    if (strpos($normalized, normalize_bitrix_text((string)bitrix_config('BITRIX_TZ_STAGE_NAME', 'Подготовка ТЗ'))) !== false) return 'tz';
    if (strpos($normalized, normalize_bitrix_text((string)bitrix_config('BITRIX_TZ_APPROVAL_STAGE_NAME', 'Согласование ТЗ'))) !== false) return 'tzApproval';
    if (strpos($normalized, normalize_bitrix_text((string)bitrix_config('BITRIX_PRODUCTION_STAGE_NAME', 'В производстве'))) !== false) return 'production';
    if (strpos($normalized, normalize_bitrix_text((string)bitrix_config('BITRIX_DEFECT_STAGE_NAME', 'КОСЯК'))) !== false) return 'defect';
    return 'launch';
}

function normalize_bitrix_supervisor($value)
{
    $text = first_text($value);
    if ($text === '') return '';
    return preg_match('/^\d+$/', $text) ? ('ID ' . $text) : $text;
}

function extract_bitrix_user_photo($user)
{
    foreach (['PERSONAL_PHOTO', 'WORK_LOGO', 'PERSONAL_PHOTO_URL'] as $field) {
        $url = first_text(array_get($user, $field, ''));
        if ($url !== '' && !preg_match('/^\d+$/', $url)) return absolute_bitrix_file_url($url, bitrix_domain());
    }
    return '';
}

function extract_bitrix_user_phone($user)
{
    foreach (['PERSONAL_MOBILE', 'PERSONAL_MOBILE_PHONE', 'UF_MOBILE_PHONE', 'WORK_PHONE', 'PERSONAL_PHONE', 'UF_PHONE', 'UF_MOBILE', 'UF_WORK_PHONE'] as $field) {
        $phone = extract_phone_value(array_get($user, $field, ''), false);
        if ($phone !== '') return $phone;
    }
    foreach ($user as $field => $value) {
        if (!preg_match('/PHONE|MOBILE|TEL/i', (string)$field) || preg_match('/INNER|INTERNAL|EXTENSION/i', (string)$field)) continue;
        $phone = extract_phone_value($value, false);
        if ($phone !== '') return $phone;
    }
    return '';
}

function extract_bitrix_user_internal_phone($user)
{
    foreach (['UF_PHONE_INNER', 'UF_PHONE_INTERNAL', 'UF_INNER_PHONE', 'UF_INTERNAL_PHONE', 'UF_EXTENSION', 'WORK_PHONE_INNER', 'UF_WORK_PHONE_INNER'] as $field) {
        $phone = extract_phone_value(array_get($user, $field, ''), true);
        if ($phone !== '') return $phone;
    }
    foreach ($user as $field => $value) {
        if (!preg_match('/INNER|INTERNAL|EXTENSION/i', (string)$field)) continue;
        $phone = extract_phone_value($value, true);
        if ($phone !== '') return $phone;
    }
    return '';
}

function extract_phone_value($value, $allowExtension)
{
    if (is_array($value)) {
        foreach ($value as $item) {
            $phone = extract_phone_value($item, $allowExtension);
            if ($phone !== '') return $phone;
        }
        return '';
    }
    return normalize_phone_text($value, $allowExtension);
}

function normalize_phone_text($value, $allowExtension)
{
    $text = trim(preg_replace('/\s+/', ' ', (string)$value));
    if ($text === '') return '';
    $digits = preg_replace('/\D/', '', $text);
    $compact = preg_replace('/[^\d+]/', '', $text);
    if ($allowExtension && preg_match('/^\d{3,5}$/', $digits) && $digits === $text) return $text;
    if (preg_match('/^\+?7\d{10}$/', $compact)) return $text;
    if (preg_match('/^8\d{10}$/', $digits)) return $text;
    if (preg_match('/^(\+7|7|8)/', $compact) && strlen($digits) === 11) return $text;
    return '';
}

function normalize_bitrix_date($value)
{
    $text = first_text($value);
    if ($text === '' || preg_match('/^\d+$/', $text)) return '';
    $timestamp = strtotime($text);
    return $timestamp ? gmdate('c', $timestamp) : '';
}

function first_text()
{
    foreach (func_get_args() as $value) {
        $text = normalize_text_value($value);
        if ($text !== '') return $text;
    }
    return '';
}

function normalize_text_value($value)
{
    if (is_array($value)) {
        foreach ($value as $item) {
            $text = normalize_text_value($item);
            if ($text !== '') return $text;
        }
        return '';
    }
    return trim(preg_replace('/\s+/', ' ', (string)$value));
}

function normalize_bitrix_text($value)
{
    $raw = trim((string)$value);
    $text = function_exists('mb_strtolower') ? mb_strtolower($raw, 'UTF-8') : strtolower($raw);
    $text = preg_replace('/\s+/u', ' ', $text);
    return $text ?: '';
}

function to_number($value)
{
    if (is_numeric($value)) return (float)$value;
    $normalized = str_replace([' ', ','], ['', '.'], (string)$value);
    return is_numeric($normalized) ? (float)$normalized : 0;
}

function bitrix_config($name, $default = '')
{
    $env = getenv($name);
    if ($env !== false && $env !== '') return $env;
    $config = bitrix_local_config();
    if (array_key_exists($name, $config) && $config[$name] !== '') return $config[$name];
    return $default;
}

function bitrix_local_config()
{
    static $config = null;
    if ($config !== null) return $config;

    $config = [];
    $paths = [
        dirname(__DIR__) . DIRECTORY_SEPARATOR . '.server-config.php',
        __DIR__ . DIRECTORY_SEPARATOR . 'local-config.php',
    ];

    foreach ($paths as $path) {
        if (!is_file($path)) continue;
        $loaded = include $path;
        if (is_array($loaded)) $config = array_merge($config, $loaded);
    }

    return $config;
}
