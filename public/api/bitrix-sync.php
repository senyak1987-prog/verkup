<?php

const BITRIX_DEFAULT_SYNC_INTERVAL_SECONDS = 300;
const BITRIX_SYNC_LOCK_SECONDS = 60;
const BITRIX_TECH_SPEC_CACHE_TTL_SECONDS = 21600;
const BITRIX_TECH_SPEC_MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024;

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
        refresh_bitrix_tech_spec_index_from_deals(array_get($data, 'items', []), 'sync');

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
    upsert_bitrix_tech_spec_index_from_deal($normalized, 'event');

    return [
        'success' => true,
        'skipped' => false,
        'action' => $inserted ? 'updated' : 'added',
        'dealId' => $id,
        'data' => $data,
    ];
}

function fetch_bitrix_deal_tech_spec_files_cached($dealId, $force = false, $import = false)
{
    $id = trim((string)$dealId);
    if ($id === '') throw new RuntimeException('Deal id is required');

    $entry = bitrix_tech_spec_index_entry($id);
    if (!$force && $entry && !bitrix_tech_spec_cache_expired($entry)) {
        $importSummary = null;
        if ($import) {
            $imported = import_bitrix_tech_spec_index_entry_files($id, $entry, false);
            $entry = array_get($imported, 'entry', $entry);
            $importSummary = array_get($imported, 'summary', null);
        }
        $response = bitrix_tech_spec_response_from_index_entry($entry, true);
        if (is_array($importSummary)) $response['import'] = $importSummary;
        return $response;
    }

    try {
        $result = fetch_bitrix_deal_tech_spec_files($id);
        $techSpecFiles = array_get($result, 'techSpecFiles', []);
        $installationFiles = array_get($result, 'installationFiles', []);
        $importSummary = null;

        if ($import) {
            $importedFiles = import_bitrix_deal_tech_spec_file_sets($id, $techSpecFiles, $installationFiles, $force);
            $techSpecFiles = array_get($importedFiles, 'techSpecFiles', []);
            $installationFiles = array_get($importedFiles, 'installationFiles', []);
            $importSummary = array_get($importedFiles, 'summary', null);
        }

        $entry = upsert_bitrix_tech_spec_index_from_files(
            $id,
            $techSpecFiles,
            $installationFiles,
            $import ? 'local_import' : ($force ? 'manual' : 'direct')
        );
        update_bitrix_deal_tech_spec_files_in_cache($id, $entry);

        $response = array_merge($result, [
            'cached' => false,
            'checkedAt' => array_get($entry, 'checkedAt', ''),
            'status' => array_get($entry, 'status', 'missing'),
            'fileCount' => (int)array_get($entry, 'fileCount', 0),
            'imageCount' => (int)array_get($entry, 'imageCount', 0),
            'preview' => array_get($entry, 'preview', null),
            'techSpecFiles' => bitrix_file_array($techSpecFiles),
            'installationFiles' => bitrix_file_array($installationFiles),
        ]);
        if (is_array($importSummary)) $response['import'] = $importSummary;
        return $response;
    } catch (Exception $error) {
        if ($entry) {
            $importSummary = null;
            if ($import) {
                $imported = import_bitrix_tech_spec_index_entry_files($id, $entry, false);
                $entry = array_get($imported, 'entry', $entry);
                $importSummary = array_get($imported, 'summary', null);
            }
            $response = bitrix_tech_spec_response_from_index_entry($entry, true);
            $response['stale'] = true;
            $response['warning'] = $error->getMessage();
            if (is_array($importSummary)) $response['import'] = $importSummary;
            return $response;
        }
        throw $error;
    }
}

function fetch_bitrix_deal_tech_spec_files($dealId)
{
    $id = trim((string)$dealId);
    if ($id === '') throw new RuntimeException('Deal id is required');
    if (!bitrix_config('BITRIX_WEBHOOK_URL', '')) throw new RuntimeException('BITRIX_WEBHOOK_URL is not configured');

    $response = call_bitrix_rest('crm.deal.get', ['id' => $id]);
    $deal = array_get($response, 'result', []);
    if (!is_array($deal) || count($deal) === 0) {
        $checkedAt = gmdate('c');
        return [
            'success' => true,
            'dealId' => $id,
            'techSpecFiles' => [],
            'installationFiles' => [],
            'checkedAt' => $checkedAt,
            'status' => 'missing',
            'fileCount' => 0,
            'imageCount' => 0,
        ];
    }

    $fields = bitrix_live_field_names();
    $labels = array_replace(load_bitrix_custom_field_labels(), bitrix_known_tech_spec_file_labels());
    $bitrixDomain = bitrix_domain();
    $configuredTechSpecFileFields = $fields['techSpecFiles'] ? bitrix_field_list($fields['techSpecFiles']) : [];
    $inferredTechSpecFileFields = infer_deal_tech_spec_file_fields($deal, $labels);
    $techSpecFileFields = array_values(array_unique(array_merge($configuredTechSpecFileFields, $inferredTechSpecFileFields)));
    $techSpecFiles = count($techSpecFileFields) > 0
        ? bitrix_deal_files_from_fields($deal, $techSpecFileFields, $labels, $bitrixDomain)
        : tag_bitrix_deal_files(extract_bitrix_deal_files(infer_deal_file_field($deal), $bitrixDomain), 'techSpec', '');
    $installationSource = $fields['installFiles'] ? array_get($deal, $fields['installFiles'], null) : infer_deal_file_field($deal);

    $installationFiles = tag_bitrix_deal_files(extract_bitrix_deal_files($installationSource, $bitrixDomain), 'installation', $fields['installFiles']);
    $status = bitrix_tech_spec_status_payload($techSpecFiles, $installationFiles);

    return [
        'success' => true,
        'dealId' => $id,
        'techSpecFiles' => $techSpecFiles,
        'installationFiles' => $installationFiles,
        'checkedAt' => array_get($status, 'checkedAt', ''),
        'status' => array_get($status, 'status', 'missing'),
        'fileCount' => array_get($status, 'fileCount', 0),
        'imageCount' => array_get($status, 'imageCount', 0),
        'preview' => array_get($status, 'preview', null),
    ];
}

function import_bitrix_tech_spec_index_entry_files($dealId, $entry, $force = false)
{
    $imported = import_bitrix_deal_tech_spec_file_sets(
        $dealId,
        array_get($entry, 'techSpecFiles', []),
        array_get($entry, 'installationFiles', []),
        $force
    );
    $nextEntry = upsert_bitrix_tech_spec_index_from_files(
        $dealId,
        array_get($imported, 'techSpecFiles', []),
        array_get($imported, 'installationFiles', []),
        'local_import'
    );
    update_bitrix_deal_tech_spec_files_in_cache($dealId, $nextEntry);

    return [
        'entry' => $nextEntry,
        'summary' => array_get($imported, 'summary', []),
    ];
}

function import_bitrix_deal_tech_spec_file_sets($dealId, $techSpecFiles, $installationFiles, $force = false)
{
    $summary = [
        'downloaded' => 0,
        'failed' => 0,
        'kept' => 0,
        'total' => 0,
    ];

    return [
        'techSpecFiles' => import_bitrix_deal_file_list($dealId, $techSpecFiles, $force, $summary),
        'installationFiles' => import_bitrix_deal_file_list($dealId, $installationFiles, $force, $summary),
        'summary' => $summary,
    ];
}

function handle_bitrix_tech_spec_file_push()
{
    $body = request_json_if_possible();
    $dealId = bitrix_extract_deal_id($body);
    if ($dealId === '') $dealId = bitrix_extract_deal_id($_POST);
    if ($dealId === '') {
        $dealId = trim((string)first_defined(
            array_get($_GET, 'dealId', ''),
            array_get($_GET, 'deal_id', ''),
            array_get($_GET, 'ID', '')
        ));
    }
    $dealId = sanitize_segment($dealId);
    if ($dealId === '') throw new RuntimeException('Deal id is required');

    $incomingFiles = bitrix_pushed_files_from_request($body);
    if (!count($incomingFiles)) throw new RuntimeException('No file payload received');

    $summary = [
        'downloaded' => 0,
        'failed' => 0,
        'kept' => 0,
        'total' => 0,
    ];
    $storedFiles = import_bitrix_deal_file_list($dealId, $incomingFiles, true, $summary);
    $storedFiles = array_values(array_filter($storedFiles, function ($file) {
        return is_array($file) && array_get($file, 'localUrl', '') !== '';
    }));

    $entry = bitrix_tech_spec_index_entry($dealId);
    $techSpecFiles = bitrix_merge_file_arrays(
        is_array($entry) ? array_get($entry, 'techSpecFiles', []) : [],
        $storedFiles
    );
    $installationFiles = is_array($entry) ? bitrix_file_array(array_get($entry, 'installationFiles', [])) : [];
    $entry = upsert_bitrix_tech_spec_index_from_files($dealId, $techSpecFiles, $installationFiles, 'push');
    update_bitrix_deal_tech_spec_files_in_cache($dealId, $entry);

    return [
        'success' => true,
        'dealId' => $dealId,
        'stored' => count($storedFiles),
        'summary' => $summary,
        'techSpecFiles' => bitrix_file_array($techSpecFiles),
        'checkedAt' => array_get($entry, 'checkedAt', gmdate('c')),
    ];
}

function bitrix_pushed_files_from_request($body)
{
    $files = [];
    if (is_array($body)) {
        $bodyFiles = array_get($body, 'files', null);
        if (is_array($bodyFiles)) {
            foreach ($bodyFiles as $index => $file) {
                if (is_array($file)) $files[] = bitrix_normalize_pushed_file($file, $index);
            }
        } elseif (bitrix_request_has_inline_file_payload($body)) {
            $files[] = bitrix_normalize_pushed_file($body, 0);
        }
    }

    foreach (bitrix_uploaded_files_from_request() as $file) {
        $files[] = $file;
    }

    return array_values(array_filter($files, 'is_array'));
}

function bitrix_request_has_inline_file_payload($value)
{
    if (!is_array($value)) return false;
    foreach (['fileData', 'FILE_DATA', 'fileBase64', 'base64', 'contentBase64', 'CONTENT_BASE64', 'dataUrl', 'url', 'downloadUrl', 'fileUrl'] as $key) {
        if (array_get($value, $key, null) !== null && array_get($value, $key, '') !== '') return true;
    }
    return false;
}

function bitrix_normalize_pushed_file($file, $index)
{
    $id = first_text(array_get($file, 'id', ''), array_get($file, 'ID', ''));
    if ($id === '') $id = 'push_' . substr(sha1(json_encode($file) . '|' . $index . '|' . microtime(true)), 0, 16);
    $name = first_text(
        array_get($file, 'name', ''),
        array_get($file, 'fileName', ''),
        array_get($file, 'filename', ''),
        array_get($file, 'TITLE', ''),
        array_get($file, 'NAME', ''),
        is_array(array_get($file, 'fileData', null)) ? array_get(array_get($file, 'fileData', []), 0, '') : ''
    );
    if ($name === '') $name = 'Bitrix tech spec ' . ($index + 1);
    $url = first_text(array_get($file, 'url', ''), array_get($file, 'downloadUrl', ''), array_get($file, 'fileUrl', ''));
    return [
        'id' => (string)$id,
        'name' => $name,
        'url' => $url,
        'downloadUrl' => first_text(array_get($file, 'downloadUrl', ''), $url),
        'bitrixUrl' => first_text(array_get($file, 'bitrixUrl', ''), $url),
        'bitrixDownloadUrl' => first_text(array_get($file, 'bitrixDownloadUrl', ''), array_get($file, 'downloadUrl', ''), $url),
        'field' => sanitize_bitrix_field_name((string)first_text(array_get($file, 'field', ''), array_get($file, 'fieldName', ''), 'BITRIX_PUSH')),
        'label' => first_text(array_get($file, 'label', ''), 'ТЗ из Bitrix'),
        'mimeType' => first_text(array_get($file, 'mimeType', ''), array_get($file, 'type', '')),
        'source' => 'techSpec',
        'type' => preg_match('/\.(png|jpe?g|webp|gif)$/i', $name) || preg_match('/image/i', (string)array_get($file, 'mimeType', '')) ? 'image' : 'file',
        'fileData' => first_defined(
            array_get($file, 'fileData', null),
            array_get($file, 'FILE_DATA', null),
            array_get($file, 'fileBase64', null),
            array_get($file, 'base64', null),
            array_get($file, 'contentBase64', null),
            array_get($file, 'CONTENT_BASE64', null),
            array_get($file, 'dataUrl', null)
        ),
    ];
}

function bitrix_uploaded_files_from_request()
{
    if (!isset($_FILES) || !is_array($_FILES) || !count($_FILES)) return [];
    $result = [];
    foreach ($_FILES as $field => $entry) {
        foreach (bitrix_normalize_uploaded_file_entry($field, $entry) as $file) {
            $result[] = $file;
        }
    }
    return $result;
}

function bitrix_normalize_uploaded_file_entry($field, $entry)
{
    if (!is_array($entry)) return [];
    $names = array_get($entry, 'name', []);
    if (is_array($names)) {
        $items = [];
        foreach ($names as $index => $name) {
            $items[] = bitrix_uploaded_file_payload(
                $field,
                $name,
                array_get(array_get($entry, 'tmp_name', []), $index, ''),
                array_get(array_get($entry, 'type', []), $index, ''),
                array_get(array_get($entry, 'error', []), $index, UPLOAD_ERR_NO_FILE),
                $index
            );
        }
        return array_values(array_filter($items));
    }

    $single = bitrix_uploaded_file_payload(
        $field,
        array_get($entry, 'name', ''),
        array_get($entry, 'tmp_name', ''),
        array_get($entry, 'type', ''),
        array_get($entry, 'error', UPLOAD_ERR_NO_FILE),
        0
    );
    return $single ? [$single] : [];
}

function bitrix_uploaded_file_payload($field, $name, $tmpName, $mime, $error, $index)
{
    if ((int)$error !== UPLOAD_ERR_OK || !is_uploaded_file((string)$tmpName)) return null;
    $bytes = file_get_contents((string)$tmpName);
    if ($bytes === false || $bytes === '') return null;
    if (strlen($bytes) > BITRIX_TECH_SPEC_MAX_DOWNLOAD_BYTES) {
        throw new RuntimeException('file is too large');
    }
    $safeName = sanitize_original_name((string)$name);
    $id = 'push_' . substr(sha1($field . '|' . $safeName . '|' . $bytes), 0, 16);
    $detectedMime = bitrix_detect_mime_bytes($bytes, (string)$mime, $safeName);
    return [
        'id' => $id,
        'name' => $safeName !== '' ? $safeName : ('Bitrix tech spec ' . ($index + 1)),
        'field' => sanitize_bitrix_field_name((string)$field) ?: 'BITRIX_PUSH',
        'label' => 'ТЗ из Bitrix',
        'mimeType' => $detectedMime,
        'source' => 'techSpec',
        'type' => strpos($detectedMime, 'image/') === 0 ? 'image' : 'file',
        'rawBytes' => $bytes,
    ];
}

function bitrix_merge_file_arrays()
{
    $result = [];
    $seen = [];
    foreach (func_get_args() as $list) {
        foreach (bitrix_file_array($list) as $file) {
            if (!is_array($file)) continue;
            $key = implode('|', array_filter([
                (string)array_get($file, 'field', ''),
                (string)array_get($file, 'id', ''),
                (string)array_get($file, 'localUrl', ''),
                (string)array_get($file, 'url', ''),
                (string)array_get($file, 'name', ''),
            ]));
            if ($key === '' || isset($seen[$key])) continue;
            $seen[$key] = true;
            $result[] = $file;
        }
    }
    return $result;
}

function import_bitrix_deal_file_list($dealId, $files, $force, &$summary)
{
    $files = is_array($files) ? array_values($files) : [];
    $imported = [];
    foreach ($files as $file) {
        if (!is_array($file)) continue;
        $summary['total']++;
        $result = import_bitrix_deal_file($dealId, $file, $force);
        $status = (string)array_get($result, 'status', '');
        if (isset($summary[$status])) $summary[$status]++;
        $imported[] = array_get($result, 'file', $file);
    }
    return $imported;
}

function import_bitrix_deal_file($dealId, $file, $force = false)
{
    $file = normalize_bitrix_file_for_import($dealId, $file);
    $localPath = bitrix_local_tech_spec_path((string)array_get($file, 'localUrl', ''));
    if (!$localPath) $localPath = bitrix_local_tech_spec_path((string)array_get($file, 'url', ''));

    if (!$force && $localPath !== '' && is_file($localPath)) {
        $localUrl = first_text(array_get($file, 'localUrl', ''), array_get($file, 'url', ''));
        $file['localUrl'] = $localUrl;
        $file['url'] = $localUrl;
        $file['downloadUrl'] = $localUrl;
        $file['size'] = filesize($localPath) ?: array_get($file, 'size', 0);
        $mime = bitrix_detect_file_mime($localPath);
        if ($mime !== '') $file['mimeType'] = $mime;
        $file['type'] = bitrix_file_type_from_mime((string)array_get($file, 'mimeType', ''), (string)array_get($file, 'name', ''));
        unset($file['downloadError']);
        return ['file' => $file, 'status' => 'kept'];
    }

    try {
        $downloaded = bitrix_inline_file_bytes($file);
        if (!$downloaded) {
            $downloaded = bitrix_download_deal_file_bytes($dealId, $file);
        }
        $stored = store_bitrix_tech_spec_file_bytes(
            $dealId,
            $file,
            (string)array_get($downloaded, 'bytes', ''),
            (string)array_get($downloaded, 'mimeType', '')
        );
        $file['localUrl'] = array_get($stored, 'url', '');
        $file['url'] = array_get($stored, 'url', '');
        $file['downloadUrl'] = array_get($stored, 'url', '');
        $file['mimeType'] = array_get($stored, 'mimeType', array_get($downloaded, 'mimeType', ''));
        $file['size'] = array_get($stored, 'size', strlen((string)array_get($downloaded, 'bytes', '')));
        $file['downloadedAt'] = gmdate('c');
        $file['type'] = bitrix_file_type_from_mime((string)array_get($file, 'mimeType', ''), (string)array_get($file, 'name', ''));
        $file = clean_bitrix_file_for_storage($file);
        unset($file['downloadError']);
        return ['file' => $file, 'status' => 'downloaded'];
    } catch (Exception $error) {
        $file['downloadError'] = sanitize_bitrix_download_error($error->getMessage());
        if (!array_get($file, 'localUrl', '')) {
            $file['type'] = 'file';
        }
        return ['file' => $file, 'status' => 'failed'];
    }
}

function normalize_bitrix_file_for_import($dealId, $file)
{
    $id = trim((string)array_get($file, 'id', ''));
    if ($id === '') $id = substr(sha1((string)array_get($file, 'url', '') . '|' . json_encode($file)), 0, 16);
    $file['id'] = $id;
    $file['name'] = trim((string)array_get($file, 'name', '')) ?: ('Bitrix file ' . $id);

    $bitrixUrl = first_text(array_get($file, 'bitrixUrl', ''), array_get($file, 'url', ''));
    $bitrixDownloadUrl = first_text(array_get($file, 'bitrixDownloadUrl', ''), array_get($file, 'downloadUrl', ''), $bitrixUrl);
    if ($bitrixUrl !== '' && !bitrix_is_local_tech_spec_url($bitrixUrl)) $file['bitrixUrl'] = $bitrixUrl;
    if ($bitrixDownloadUrl !== '' && !bitrix_is_local_tech_spec_url($bitrixDownloadUrl)) $file['bitrixDownloadUrl'] = $bitrixDownloadUrl;

    if (!array_get($file, 'url', '')) {
        $file['url'] = $bitrixUrl ?: bitrix_proxy_file_url($dealId, $file);
    }
    if (!array_get($file, 'downloadUrl', '')) {
        $file['downloadUrl'] = $bitrixDownloadUrl ?: array_get($file, 'url', '');
    }
    return $file;
}

function bitrix_inline_file_bytes($file)
{
    if (array_key_exists('rawBytes', $file)) {
        $bytes = (string)array_get($file, 'rawBytes', '');
        if ($bytes !== '') {
            if (strlen($bytes) > BITRIX_TECH_SPEC_MAX_DOWNLOAD_BYTES) {
                throw new RuntimeException('file is too large');
            }
            return [
                'bytes' => $bytes,
                'mimeType' => bitrix_detect_mime_bytes(
                    $bytes,
                    (string)array_get($file, 'mimeType', ''),
                    (string)array_get($file, 'name', '')
                ),
            ];
        }
    }

    $payloads = [
        array_get($file, 'fileData', null),
        array_get($file, 'FILE_DATA', null),
        array_get($file, 'fileBase64', null),
        array_get($file, 'base64', null),
        array_get($file, 'contentBase64', null),
        array_get($file, 'CONTENT_BASE64', null),
        array_get($file, 'dataUrl', null),
    ];

    foreach ($payloads as $payload) {
        $decoded = bitrix_decode_inline_file_payload($payload, (string)array_get($file, 'name', ''));
        if ($decoded) return $decoded;
    }

    return null;
}

function bitrix_decode_inline_file_payload($payload, $name = '')
{
    if (is_array($payload)) {
        $candidateName = first_text(array_get($payload, 0, ''), array_get($payload, 'name', ''), $name);
        $candidateData = first_text(
            array_get($payload, 1, ''),
            array_get($payload, 'base64', ''),
            array_get($payload, 'fileBase64', ''),
            array_get($payload, 'contentBase64', ''),
            array_get($payload, 'data', '')
        );
        return bitrix_decode_inline_file_payload($candidateData, $candidateName);
    }

    $text = trim((string)$payload);
    if ($text === '') return null;

    $mime = '';
    if (preg_match('#^data:([^;,]+);base64,(.+)$#is', $text, $match)) {
        $mime = trim((string)$match[1]);
        $text = trim((string)$match[2]);
    }

    $text = preg_replace('/\s+/', '', $text);
    $bytes = base64_decode($text, true);
    if ($bytes === false || $bytes === '') return null;
    if (strlen($bytes) > BITRIX_TECH_SPEC_MAX_DOWNLOAD_BYTES) {
        throw new RuntimeException('file is too large');
    }

    if ($mime === '') $mime = bitrix_detect_mime_bytes($bytes, '', $name);
    return [
        'bytes' => $bytes,
        'mimeType' => $mime,
    ];
}

function bitrix_download_deal_file_bytes($dealId, $file)
{
    $errors = [];
    foreach (bitrix_file_download_candidates($dealId, $file) as $url) {
        try {
            return bitrix_fetch_binary_url($url, (string)array_get($file, 'name', ''));
        } catch (Exception $error) {
            $errors[] = sanitize_bitrix_download_error($error->getMessage());
        }
    }
    $message = count($errors) ? implode('; ', array_slice($errors, 0, 3)) : 'No download URL';
    throw new RuntimeException($message);
}

function sanitize_bitrix_download_error($message)
{
    $message = (string)$message;
    $message = preg_replace('/([?&](?:auth|access_token)=)[^;&\s]+/i', '$1***', $message);
    $message = preg_replace('#(/rest/\d+/)[^/\s?;]+#i', '$1***', $message);
    return $message ?: 'Bitrix file download failed';
}

function bitrix_file_download_candidates($dealId, $file)
{
    $candidates = [];
    $fileId = trim((string)array_get($file, 'id', ''));
    foreach (bitrix_rest_download_url_candidates($fileId) as $url) $candidates[] = $url;

    $field = sanitize_bitrix_field_name((string)array_get($file, 'field', ''));
    foreach (bitrix_crm_userfield_file_download_candidates($dealId, $field, $fileId) as $url) {
        $candidates[] = $url;
    }

    foreach ([
        array_get($file, 'bitrixDownloadUrl', ''),
        array_get($file, 'downloadUrl', ''),
        array_get($file, 'bitrixUrl', ''),
        array_get($file, 'url', ''),
    ] as $url) {
        $url = trim((string)$url);
        if ($url !== '' && !bitrix_is_local_tech_spec_url($url)) $candidates[] = $url;
    }

    if ($fileId !== '') {
        $domain = bitrix_domain();
        if ($field !== '') {
            foreach (['Y', 'N'] as $dynamic) {
                $candidates[] = absolute_bitrix_file_url(
                    '/bitrix/tools/crm_show_file.php?' . http_build_query([
                        'ownerId' => $dealId,
                        'fieldName' => $field,
                        'dynamic' => $dynamic,
                        'fileId' => $fileId,
                    ]),
                    $domain
                );
            }
            $candidates[] = absolute_bitrix_file_url(
                '/bitrix/components/bitrix/crm.deal.show/show_file.php?' . http_build_query([
                    'ownerId' => $dealId,
                    'fieldName' => $field,
                    'dynamic' => 'Y',
                    'fileId' => $fileId,
                ]),
                $domain
            );
        }
        $candidates[] = absolute_bitrix_file_url('/bitrix/tools/crm_show_file.php?fileId=' . rawurlencode($fileId), $domain);
    }

    return bitrix_expand_authenticated_url_candidates($candidates);
}

function bitrix_crm_userfield_file_download_candidates($dealId, $field, $fileId)
{
    $dealId = trim((string)$dealId);
    $field = sanitize_bitrix_field_name((string)$field);
    $fileId = trim((string)$fileId);
    if ($dealId === '' || $field === '' || $fileId === '') return [];

    $domain = bitrix_domain();
    $queries = [
        [
            'action' => 'rest.file.get',
            'entity' => 'CRM_DEAL',
            'id' => $dealId,
            'field' => $field,
            'value' => $fileId,
        ],
        [
            'action' => 'rest.file.get',
            'entity' => 'CRM_DEAL',
            'entityId' => $dealId,
            'field' => $field,
            'fileId' => $fileId,
        ],
        [
            'action' => 'rest.file.get',
            'entity' => 'CRM_DEAL',
            'ENTITY_ID' => $dealId,
            'FIELD_NAME' => $field,
            'VALUE_ID' => $fileId,
        ],
    ];

    return array_map(
        function ($query) use ($domain) {
            return absolute_bitrix_file_url('/bitrix/services/main/ajax.php?' . http_build_query($query), $domain);
        },
        $queries
    );
}

function bitrix_rest_download_url_candidates($fileId)
{
    $id = trim((string)$fileId);
    if ($id === '' || !preg_match('/^\d+$/', $id)) return [];

    $urls = [];
    foreach ([
        ['method' => 'disk.file.get', 'params' => ['id' => $id]],
        ['method' => 'disk.attachedObject.get', 'params' => ['id' => $id]],
        ['method' => 'disk.file.getExternalLink', 'params' => ['id' => $id]],
    ] as $request) {
        try {
            $response = call_bitrix_rest($request['method'], $request['params']);
            bitrix_collect_download_urls(array_get($response, 'result', []), $urls);
        } catch (Exception $error) {
            // Some Bitrix file ids are CRM file ids, not Disk object ids.
        }
    }
    return $urls;
}

function bitrix_collect_download_urls($value, &$urls)
{
    if (!is_array($value)) {
        $text = trim((string)$value);
        if ($text !== '' && preg_match('#^https?://#i', $text)) $urls[] = $text;
        return;
    }
    foreach ($value as $key => $item) {
        if (is_array($item)) {
            bitrix_collect_download_urls($item, $urls);
            continue;
        }
        $text = trim((string)$item);
        if ($text === '' || !preg_match('#^https?://#i', $text)) continue;
        $keyText = strtoupper((string)$key);
        if (strpos($keyText, 'DOWNLOAD') !== false || $keyText === 'URL' || strpos($keyText, 'URL_') === 0) {
            $urls[] = $text;
        }
    }
}

function bitrix_expand_authenticated_url_candidates($urls)
{
    $expanded = [];
    $seen = [];
    $auth = bitrix_webhook_auth_token();
    foreach ($urls as $url) {
        $url = trim((string)$url);
        if ($url === '' || bitrix_is_local_tech_spec_url($url)) continue;
        foreach ([$url, bitrix_url_with_query($url, ['download' => '1'])] as $candidate) {
            if ($candidate === '') continue;
            if (!isset($seen[$candidate])) {
                $seen[$candidate] = true;
                $expanded[] = $candidate;
            }
            $existingAuth = bitrix_url_query_value($candidate, 'auth');
            if ($auth !== '' && ($existingAuth === null || $existingAuth === '')) {
                $withAuth = bitrix_url_with_query($candidate, ['auth' => $auth]);
                if ($withAuth !== '' && !isset($seen[$withAuth])) {
                    $seen[$withAuth] = true;
                    $expanded[] = $withAuth;
                }
            }
        }
    }
    return $expanded;
}

function bitrix_fetch_binary_url($url, $name = '')
{
    $raw = '';
    $status = 0;
    $contentType = '';

    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_HEADER => true,
            CURLOPT_HTTPHEADER => ['User-Agent: Verkup/1.0'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_CONNECTTIMEOUT => 10,
        ]);
        $response = curl_exec($curl);
        $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $headerSize = (int)curl_getinfo($curl, CURLINFO_HEADER_SIZE);
        $error = curl_error($curl);
        curl_close($curl);
        if ($response === false || $response === '') throw new RuntimeException('empty response: ' . ($error ?: $url));
        $headers = substr((string)$response, 0, $headerSize);
        $raw = substr((string)$response, $headerSize);
        $contentType = bitrix_content_type_from_header_text($headers);
    } else {
        $context = stream_context_create([
            'http' => [
                'header' => "User-Agent: Verkup/1.0\r\n",
                'ignore_errors' => true,
                'timeout' => 30,
            ],
        ]);
        $raw = @file_get_contents($url, false, $context);
        $headers = isset($http_response_header) ? $http_response_header : [];
        $status = bitrix_http_status_from_headers($headers);
        $contentType = bitrix_content_type_from_headers($headers);
        if ($raw === false || $raw === '') throw new RuntimeException('empty response: ' . $url);
    }

    if ($status >= 400) throw new RuntimeException('HTTP ' . $status . ': ' . $url);
    if (strlen((string)$raw) > BITRIX_TECH_SPEC_MAX_DOWNLOAD_BYTES) {
        throw new RuntimeException('file is too large');
    }

    $probe = ltrim(substr((string)$raw, 0, 300));
    if (stripos($contentType, 'text/html') !== false || preg_match('#^<(?:!doctype|html|head|body)#i', $probe)) {
        throw new RuntimeException('Bitrix returned HTML page');
    }

    if (stripos($contentType, 'application/json') !== false) {
        $json = json_decode((string)$raw, true);
        if (is_array($json) && (isset($json['error']) || isset($json['error_description']))) {
            throw new RuntimeException(first_text(array_get($json, 'error_description', ''), array_get($json, 'error', 'Bitrix JSON error')));
        }
    }

    $mime = bitrix_detect_mime_bytes((string)$raw, $contentType, $name);
    return [
        'bytes' => (string)$raw,
        'mimeType' => $mime,
    ];
}

function store_bitrix_tech_spec_file_bytes($dealId, $file, $bytes, $mime)
{
    global $uploadsDir;
    $safeDealId = sanitize_segment((string)$dealId);
    $fileDir = $uploadsDir . DIRECTORY_SEPARATOR . 'bitrix-tech-specs' . DIRECTORY_SEPARATOR . $safeDealId;
    if (!is_dir($fileDir) && !mkdir($fileDir, 0755, true)) {
        throw new RuntimeException('Cannot create Bitrix tech spec directory');
    }

    $name = (string)array_get($file, 'name', '');
    $ext = bitrix_extension_for_download($name, $mime);
    $fileId = sanitize_segment((string)array_get($file, 'id', substr(sha1($name . $bytes), 0, 16)));
    $field = sanitize_bitrix_field_name((string)array_get($file, 'field', ''));
    $base = ($field !== '' ? strtolower($field) . '_' : '') . $fileId;
    $filename = $base . '.' . $ext;
    $path = $fileDir . DIRECTORY_SEPARATOR . $filename;
    if (file_put_contents($path, $bytes, LOCK_EX) === false) {
        throw new RuntimeException('Cannot save Bitrix tech spec file');
    }

    $prefix = public_prefix();
    $baseUrl = $prefix . '/uploads/bitrix-tech-specs/' . rawurlencode($safeDealId) . '/';
    return [
        'mimeType' => $mime,
        'size' => strlen($bytes),
        'url' => $baseUrl . rawurlencode($filename),
    ];
}

function read_bitrix_tech_spec_index()
{
    $data = read_data_file_raw('bitrix-tech-spec-index.json');
    if (!isset($data['items']) || !is_array($data['items'])) $data['items'] = [];
    $items = [];
    $seen = [];
    foreach ($data['items'] as $item) {
        if (!is_array($item)) continue;
        $dealId = trim((string)first_defined(array_get($item, 'dealId', ''), array_get($item, 'id', '')));
        if ($dealId === '' || isset($seen[$dealId])) continue;
        $seen[$dealId] = true;
        $item['id'] = $dealId;
        $item['dealId'] = $dealId;
        $items[] = $item;
    }
    $data['items'] = $items;
    if (!array_get($data, 'generatedAt', '')) $data['generatedAt'] = gmdate('c');
    return $data;
}

function write_bitrix_tech_spec_index($data)
{
    if (!is_array($data)) $data = [];
    if (!isset($data['items']) || !is_array($data['items'])) $data['items'] = [];
    $data['generatedAt'] = gmdate('c');
    write_data_file('bitrix-tech-spec-index.json', $data);
}

function bitrix_tech_spec_index_entry($dealId)
{
    $id = trim((string)$dealId);
    if ($id === '') return null;
    $index = read_bitrix_tech_spec_index();
    foreach (array_get($index, 'items', []) as $entry) {
        if (is_array($entry) && (string)array_get($entry, 'dealId', '') === $id) return $entry;
    }
    return null;
}

function bitrix_tech_spec_cache_expired($entry)
{
    $checkedAt = strtotime((string)array_get($entry, 'checkedAt', ''));
    if (!$checkedAt) return true;
    $ttl = (int)bitrix_config('BITRIX_TECH_SPEC_CACHE_TTL_SECONDS', BITRIX_TECH_SPEC_CACHE_TTL_SECONDS);
    $ttl = max(60, $ttl);
    return (time() - $checkedAt) >= $ttl;
}

function bitrix_tech_spec_status_payload($techSpecFiles, $installationFiles, $checkedAt = '')
{
    $techSpecFiles = is_array($techSpecFiles) ? array_values($techSpecFiles) : [];
    $installationFiles = is_array($installationFiles) ? array_values($installationFiles) : [];
    $files = array_values(array_merge($techSpecFiles, $installationFiles));
    $preview = null;
    $imageCount = 0;

    foreach ($files as $file) {
        if (!is_array($file)) continue;
        if ((string)array_get($file, 'type', '') === 'image') {
            $imageCount++;
            if ($preview === null) $preview = $file;
        }
    }
    if ($preview === null) {
        foreach ($files as $file) {
            if (is_array($file)) {
                $preview = $file;
                break;
            }
        }
    }

    return [
        'checkedAt' => $checkedAt !== '' ? $checkedAt : gmdate('c'),
        'status' => count($files) > 0 ? 'found' : 'missing',
        'fileCount' => count($files),
        'imageCount' => $imageCount,
        'preview' => $preview,
    ];
}

function bitrix_tech_spec_index_entry_from_files($dealId, $techSpecFiles, $installationFiles, $source = 'sync')
{
    $id = trim((string)$dealId);
    $techSpecFiles = bitrix_file_array($techSpecFiles);
    $installationFiles = bitrix_file_array($installationFiles);
    $status = bitrix_tech_spec_status_payload($techSpecFiles, $installationFiles);

    return [
        'id' => $id,
        'dealId' => $id,
        'checkedAt' => array_get($status, 'checkedAt', gmdate('c')),
        'source' => $source,
        'status' => array_get($status, 'status', 'missing'),
        'fileCount' => (int)array_get($status, 'fileCount', 0),
        'imageCount' => (int)array_get($status, 'imageCount', 0),
        'preview' => array_get($status, 'preview', null),
        'techSpecFiles' => $techSpecFiles,
        'installationFiles' => $installationFiles,
    ];
}

function upsert_bitrix_tech_spec_index_from_files($dealId, $techSpecFiles, $installationFiles, $source = 'sync')
{
    $entry = bitrix_tech_spec_index_entry_from_files($dealId, $techSpecFiles, $installationFiles, $source);
    if ((string)array_get($entry, 'dealId', '') === '') return $entry;

    $index = read_bitrix_tech_spec_index();
    $items = [];
    $inserted = false;
    foreach (array_get($index, 'items', []) as $item) {
        if (!is_array($item)) continue;
        if ((string)array_get($item, 'dealId', '') === (string)array_get($entry, 'dealId', '')) {
            $items[] = $entry;
            $inserted = true;
        } else {
            $items[] = $item;
        }
    }
    if (!$inserted) array_unshift($items, $entry);
    $index['items'] = $items;
    write_bitrix_tech_spec_index($index);
    return $entry;
}

function upsert_bitrix_tech_spec_index_from_deal($deal, $source = 'sync')
{
    if (!is_array($deal)) return null;
    $dealId = (string)array_get($deal, 'id', '');
    if ($dealId === '') return null;
    return upsert_bitrix_tech_spec_index_from_files(
        $dealId,
        array_get($deal, 'techSpecFiles', []),
        array_get($deal, 'installationFiles', []),
        $source
    );
}

function refresh_bitrix_tech_spec_index_from_deals($deals, $source = 'sync')
{
    if (!is_array($deals)) return;
    $index = read_bitrix_tech_spec_index();
    $entriesByDealId = [];
    foreach (array_get($index, 'items', []) as $item) {
        if (!is_array($item)) continue;
        $dealId = (string)array_get($item, 'dealId', '');
        if ($dealId !== '') $entriesByDealId[$dealId] = $item;
    }

    foreach ($deals as $deal) {
        if (!is_array($deal)) continue;
        $dealId = (string)array_get($deal, 'id', '');
        if ($dealId === '') continue;
        $entriesByDealId[$dealId] = bitrix_tech_spec_index_entry_from_files(
            $dealId,
            array_get($deal, 'techSpecFiles', []),
            array_get($deal, 'installationFiles', []),
            $source
        );
    }

    $items = array_values($entriesByDealId);
    usort($items, function ($first, $second) {
        return strcmp((string)array_get($second, 'checkedAt', ''), (string)array_get($first, 'checkedAt', ''));
    });
    write_bitrix_tech_spec_index(['items' => $items]);
}

function remove_bitrix_tech_spec_index_entry($dealId)
{
    $id = trim((string)$dealId);
    if ($id === '') return;
    $index = read_bitrix_tech_spec_index();
    $index['items'] = array_values(array_filter(array_get($index, 'items', []), function ($entry) use ($id) {
        return !is_array($entry) || (string)array_get($entry, 'dealId', '') !== $id;
    }));
    write_bitrix_tech_spec_index($index);
}

function bitrix_tech_spec_response_from_index_entry($entry, $cached)
{
    $techSpecFiles = bitrix_file_array(array_get($entry, 'techSpecFiles', []));
    $installationFiles = bitrix_file_array(array_get($entry, 'installationFiles', []));
    $status = bitrix_tech_spec_status_payload(
        $techSpecFiles,
        $installationFiles,
        (string)array_get($entry, 'checkedAt', '')
    );

    return [
        'success' => true,
        'cached' => $cached,
        'dealId' => (string)array_get($entry, 'dealId', ''),
        'techSpecFiles' => $techSpecFiles,
        'installationFiles' => $installationFiles,
        'checkedAt' => array_get($status, 'checkedAt', ''),
        'status' => array_get($status, 'status', 'missing'),
        'fileCount' => array_get($status, 'fileCount', 0),
        'imageCount' => array_get($status, 'imageCount', 0),
        'preview' => array_get($status, 'preview', null),
    ];
}

function update_bitrix_deal_tech_spec_files_in_cache($dealId, $entry)
{
    $id = trim((string)$dealId);
    if ($id === '' || !is_array($entry)) return;

    $data = read_data_file_raw('deals.json');
    $items = array_get($data, 'items', []);
    if (!is_array($items)) return;

    $updated = false;
    foreach ($items as &$item) {
        if (!is_array($item) || (string)array_get($item, 'id', '') !== $id) continue;
        $item['techSpecFiles'] = bitrix_file_array(array_get($entry, 'techSpecFiles', []));
        $item['installationFiles'] = bitrix_file_array(array_get($entry, 'installationFiles', []));
        $item['bitrixTechSpecStatus'] = bitrix_tech_spec_status_payload(
            $item['techSpecFiles'],
            $item['installationFiles'],
            (string)array_get($entry, 'checkedAt', '')
        );
        $updated = true;
        break;
    }
    unset($item);

    if (!$updated) return;
    $data['items'] = $items;
    $data['generatedAt'] = gmdate('c');
    write_data_file('deals.json', $data);
}

function bitrix_file_array($value)
{
    if (!is_array($value)) return [];
    return array_values(array_map('clean_bitrix_file_for_storage', $value));
}

function clean_bitrix_file_for_storage($file)
{
    if (!is_array($file)) return $file;
    foreach ([
        'base64',
        'contentBase64',
        'CONTENT_BASE64',
        'dataUrl',
        'fileBase64',
        'fileData',
        'FILE_DATA',
        'rawBytes',
        'bytes',
    ] as $key) {
        unset($file[$key]);
    }
    return $file;
}

function sanitize_bitrix_field_name($value)
{
    $safe = preg_replace('/[^a-zA-Z0-9_]+/', '_', trim((string)$value));
    $safe = trim((string)$safe, '_');
    return $safe !== '' ? substr($safe, 0, 96) : '';
}

function stream_bitrix_deal_file($dealId, $fileId, $field = '', $download = false)
{
    $entry = bitrix_tech_spec_index_entry($dealId);
    if (!$entry) {
        $response = fetch_bitrix_deal_tech_spec_files_cached($dealId, true, true);
        $entry = bitrix_tech_spec_index_entry($dealId);
        if (!$entry && is_array($response)) {
            $entry = bitrix_tech_spec_index_entry_from_files(
                $dealId,
                array_get($response, 'techSpecFiles', []),
                array_get($response, 'installationFiles', []),
                'direct'
            );
        }
    } else {
        $imported = import_bitrix_tech_spec_index_entry_files($dealId, $entry, false);
        $entry = array_get($imported, 'entry', $entry);
    }

    $file = find_bitrix_index_file($entry, $fileId, $field);
    if (!$file) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Bitrix file not found';
        exit;
    }

    $path = bitrix_local_tech_spec_path((string)first_text(array_get($file, 'localUrl', ''), array_get($file, 'url', '')));
    if ($path === '' || !is_file($path)) {
        $result = import_bitrix_deal_file($dealId, $file, true);
        $file = array_get($result, 'file', $file);
        $path = bitrix_local_tech_spec_path((string)first_text(array_get($file, 'localUrl', ''), array_get($file, 'url', '')));
    }

    if ($path === '' || !is_file($path)) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Bitrix file could not be downloaded';
        exit;
    }

    $mime = bitrix_detect_file_mime($path) ?: (string)array_get($file, 'mimeType', 'application/octet-stream');
    $name = sanitize_original_name((string)array_get($file, 'name', basename($path)));
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: ' . ($download ? 'attachment' : 'inline') . '; filename="' . addslashes($name) . '"');
    readfile($path);
    exit;
}

function find_bitrix_index_file($entry, $fileId, $field = '')
{
    if (!is_array($entry)) return null;
    $needleId = trim((string)$fileId);
    $needleField = sanitize_bitrix_field_name($field);
    foreach (array_merge(bitrix_file_array(array_get($entry, 'techSpecFiles', [])), bitrix_file_array(array_get($entry, 'installationFiles', []))) as $file) {
        if (!is_array($file)) continue;
        if ((string)array_get($file, 'id', '') !== $needleId) continue;
        if ($needleField !== '' && sanitize_bitrix_field_name((string)array_get($file, 'field', '')) !== $needleField) continue;
        return $file;
    }
    return null;
}

function bitrix_proxy_file_url($dealId, $file)
{
    $query = [];
    $field = sanitize_bitrix_field_name((string)array_get($file, 'field', ''));
    if ($field !== '') $query['field'] = $field;
    $suffix = count($query) ? ('?' . http_build_query($query)) : '';
    return public_prefix() . '/api/bitrix/file/' . rawurlencode((string)$dealId) . '/' . rawurlencode((string)array_get($file, 'id', 'file')) . $suffix;
}

function bitrix_is_local_tech_spec_url($url)
{
    return bitrix_local_tech_spec_path($url) !== '';
}

function bitrix_local_tech_spec_path($url)
{
    global $uploadsDir;
    $url = trim((string)$url);
    if ($url === '') return '';
    $path = parse_url($url, PHP_URL_PATH);
    if (!$path) $path = $url;
    $path = rawurldecode(str_replace('\\', '/', $path));
    $prefix = public_prefix() . '/uploads/bitrix-tech-specs/';
    if (strpos($path, $prefix) !== 0) return '';
    $relative = substr($path, strlen($prefix));
    if ($relative === '' || strpos($relative, '..') !== false) return '';
    $parts = array_values(array_filter(explode('/', $relative), function ($part) {
        return $part !== '' && $part !== '.';
    }));
    if (count($parts) < 2) return '';
    foreach ($parts as $part) {
        if (sanitize_segment($part) === 'unknown' && $part !== 'unknown') return '';
    }
    return $uploadsDir . DIRECTORY_SEPARATOR . 'bitrix-tech-specs' . DIRECTORY_SEPARATOR . implode(DIRECTORY_SEPARATOR, $parts);
}

function bitrix_detect_file_mime($path)
{
    if (!is_file($path)) return '';
    if (class_exists('finfo')) {
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = strtolower((string)$finfo->file($path));
        if ($mime !== '') return $mime;
    }
    return 'application/octet-stream';
}

function bitrix_detect_mime_bytes($bytes, $contentType = '', $name = '')
{
    $mime = strtolower(trim(preg_replace('/;.*/', '', (string)$contentType)));
    if ($mime === '' || $mime === 'application/octet-stream') {
        if (class_exists('finfo')) {
            $finfo = new finfo(FILEINFO_MIME_TYPE);
            $detected = strtolower((string)$finfo->buffer($bytes));
            if ($detected !== '') $mime = $detected;
        }
    }
    if ($mime === '' || $mime === 'application/octet-stream') {
        $ext = strtolower(pathinfo((string)$name, PATHINFO_EXTENSION));
        $byExt = [
            'jpg' => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'webp' => 'image/webp',
            'gif' => 'image/gif',
            'pdf' => 'application/pdf',
            'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'xls' => 'application/vnd.ms-excel',
            'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'doc' => 'application/msword',
            'csv' => 'text/csv',
            'txt' => 'text/plain',
        ];
        if (isset($byExt[$ext])) $mime = $byExt[$ext];
    }
    return $mime ?: 'application/octet-stream';
}

function bitrix_extension_for_download($name, $mime)
{
    $ext = strtolower(pathinfo((string)$name, PATHINFO_EXTENSION));
    $allowed = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'xlsx', 'xls', 'docx', 'doc', 'csv', 'txt'];
    if (in_array($ext, $allowed, true)) return $ext === 'jpeg' ? 'jpg' : $ext;

    switch (strtolower((string)$mime)) {
        case 'image/jpeg':
        case 'image/pjpeg':
            return 'jpg';
        case 'image/png':
            return 'png';
        case 'image/webp':
            return 'webp';
        case 'image/gif':
            return 'gif';
        case 'application/pdf':
            return 'pdf';
        case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
            return 'xlsx';
        case 'application/vnd.ms-excel':
            return 'xls';
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
            return 'docx';
        case 'application/msword':
            return 'doc';
        case 'text/csv':
            return 'csv';
        case 'text/plain':
            return 'txt';
        default:
            return 'bin';
    }
}

function bitrix_file_type_from_mime($mime, $name = '')
{
    $mime = strtolower((string)$mime);
    if (strpos($mime, 'image/') === 0) return 'image';
    return preg_match('/\.(png|jpe?g|webp|gif)$/i', (string)$name) ? 'image' : 'file';
}

function bitrix_content_type_from_header_text($headers)
{
    $contentType = '';
    foreach (preg_split('/\r?\n/', (string)$headers) as $header) {
        if (stripos($header, 'Content-Type:') === 0) {
            $contentType = trim(substr($header, strlen('Content-Type:')));
        }
    }
    return $contentType;
}

function bitrix_content_type_from_headers($headers)
{
    foreach ((array)$headers as $header) {
        if (stripos((string)$header, 'Content-Type:') === 0) {
            return trim(substr((string)$header, strlen('Content-Type:')));
        }
    }
    return '';
}

function bitrix_webhook_auth_token()
{
    $webhook = trim((string)bitrix_config('BITRIX_WEBHOOK_URL', ''));
    if ($webhook === '') return '';
    $query = [];
    $rawQuery = parse_url($webhook, PHP_URL_QUERY);
    if (is_string($rawQuery) && $rawQuery !== '') {
        parse_str($rawQuery, $query);
        $token = first_text(array_get($query, 'auth', ''), array_get($query, 'access_token', ''));
        if ($token !== '') return $token;
    }
    $path = trim((string)parse_url($webhook, PHP_URL_PATH), '/');
    $parts = $path === '' ? [] : explode('/', $path);
    for ($index = 0; $index < count($parts); $index++) {
        if ($parts[$index] === 'rest' && isset($parts[$index + 2])) return (string)$parts[$index + 2];
    }
    return '';
}

function bitrix_url_with_query($url, $params)
{
    $url = trim((string)$url);
    if ($url === '') return '';
    $parts = parse_url($url);
    if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) return $url;
    $query = [];
    if (!empty($parts['query'])) parse_str($parts['query'], $query);
    foreach ($params as $key => $value) {
        if ($value !== '') $query[$key] = $value;
    }
    $rebuilt = $parts['scheme'] . '://' . $parts['host'];
    if (!empty($parts['port'])) $rebuilt .= ':' . $parts['port'];
    $rebuilt .= array_get($parts, 'path', '');
    if (count($query)) $rebuilt .= '?' . http_build_query($query);
    if (!empty($parts['fragment'])) $rebuilt .= '#' . $parts['fragment'];
    return $rebuilt;
}

function bitrix_url_query_value($url, $key)
{
    $parts = parse_url((string)$url);
    if (!is_array($parts) || empty($parts['query'])) return null;
    $query = [];
    parse_str($parts['query'], $query);
    return array_key_exists($key, $query) ? (string)$query[$key] : null;
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
    remove_bitrix_tech_spec_index_entry($id);

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
    $fieldLabels = array_replace(array_get($dictionaries, 'customFieldLabels', []), bitrix_known_tech_spec_file_labels());
    $techSpecFileFields = $fields['techSpecFiles']
        ? bitrix_field_list($fields['techSpecFiles'])
        : infer_deal_tech_spec_file_fields($deal, $fieldLabels);
    $techSpecFileSource = count($techSpecFileFields) > 0 ? null : infer_deal_file_field($deal);
    $installationFiles = tag_bitrix_deal_files(extract_bitrix_deal_files($fileSource, $bitrixDomain), 'installation', $fields['installFiles']);
    $techSpecFiles = count($techSpecFileFields) > 0
        ? bitrix_deal_files_from_fields($deal, $techSpecFileFields, $fieldLabels, $bitrixDomain)
        : tag_bitrix_deal_files(extract_bitrix_deal_files($techSpecFileSource, $bitrixDomain), 'techSpec', '');
    $bitrixTechSpecStatus = bitrix_tech_spec_status_payload($techSpecFiles, $installationFiles);

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
        'bitrixTechSpecStatus' => $bitrixTechSpecStatus,
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

function bitrix_field_list($value)
{
    $items = preg_split('/[,;\s]+/', trim((string)$value));
    return array_values(array_filter(array_map('trim', is_array($items) ? $items : [])));
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

function infer_deal_tech_spec_file_fields($deal, $labels = [])
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
        'ИЗГОТОВЛ',
        'ПРОИЗВОДСТВ',
    ];

    $fields = [];
    foreach (bitrix_known_tech_spec_file_labels() as $field => $label) {
        if (!array_key_exists($field, $deal)) continue;
        if (count(extract_bitrix_deal_files($deal[$field], bitrix_domain())) <= 0) continue;
        $fields[] = (string)$field;
    }

    foreach ($deal as $field => $value) {
        $haystack = normalize_bitrix_text((string)$field . ' ' . (string)array_get($labels, (string)$field, ''));
        $matched = false;
        foreach ($keywords as $keyword) {
            if ($keyword !== '' && strpos($haystack, normalize_bitrix_text($keyword)) !== false) {
                $matched = true;
                break;
            }
        }
        if (!$matched) continue;
        if (count(extract_bitrix_deal_files($value, bitrix_domain())) <= 0) continue;
        $fields[] = (string)$field;
    }

    return array_values(array_unique($fields));
}

function bitrix_deal_files_from_fields($deal, $fields, $labels, $bitrixDomain)
{
    $items = [];
    $seen = [];
    foreach ($fields as $field) {
        $fieldName = (string)$field;
        if ($fieldName === '' || !array_key_exists($fieldName, $deal)) continue;

        $label = (string)array_get($labels, $fieldName, array_get(bitrix_known_tech_spec_file_labels(), $fieldName, $fieldName));
        $files = tag_bitrix_deal_files(extract_bitrix_deal_files($deal[$fieldName], $bitrixDomain), 'techSpec', $fieldName);
        $imageHint = is_bitrix_tech_spec_image_field($fieldName, $label);
        foreach ($files as $file) {
            if (!is_array($file)) continue;
            $key = (string)array_get($file, 'url', '') . '|' . (string)array_get($file, 'id', '');
            if ($key !== '|' && isset($seen[$key])) continue;
            $seen[$key] = true;
            $file['label'] = $label;
            if ($imageHint) $file['type'] = 'image';
            $items[] = $file;
        }
    }
    return $items;
}

function bitrix_known_tech_spec_file_labels()
{
    return [
        'UF_CRM_1780210628536' => 'Файлы для изготовления',
        'UF_CRM_1780210710633' => 'Техническое задание',
        'UF_CRM_1780210754519' => 'Картинка ТЗ',
        'UF_CRM_1780210789100' => 'Прочие файлы',
        'UF_CRM_1547662737317' => 'Техническое задание',
        'UF_CRM_1547663064114' => 'Картинка ТЗ',
        'UF_CRM_1547663050818' => 'Файлы для изготовления',
        'UF_CRM_1776076725037' => 'Файлы для производства',
        'UF_CRM_1772524090753' => 'Файлы для производства',
        'UF_CRM_1547663085114' => 'Файлы для производства',
        'UF_CRM_1547663096233' => 'Файлы для производства',
    ];
}

function is_bitrix_tech_spec_image_field($field, $label)
{
    $text = normalize_bitrix_text((string)$field . ' ' . (string)$label);
    foreach (['КАРТИН', 'IMAGE', 'PHOTO', 'PICTURE', 'ФОТО'] as $needle) {
        if (strpos($text, normalize_bitrix_text($needle)) !== false) return true;
    }
    return false;
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
        $inlineFile = bitrix_inline_file_from_value($value, $bitrixDomain, count($files) + 1);
        if ($inlineFile) {
            $files[] = $inlineFile;
            return;
        }

        $url = first_text(
            array_get($value, 'URL', ''),
            array_get($value, 'SRC', ''),
            array_get($value, 'SHOW_URL', ''),
            array_get($value, 'showUrl', ''),
            array_get($value, 'DOWNLOAD_URL', ''),
            array_get($value, 'URL_MACHINE', ''),
            array_get($value, 'urlMachine', ''),
            array_get($value, 'downloadUrl', ''),
            array_get($value, 'url', '')
        );
        $downloadUrl = first_text(
            array_get($value, 'DOWNLOAD_URL', ''),
            array_get($value, 'URL_MACHINE', ''),
            array_get($value, 'urlMachine', ''),
            array_get($value, 'downloadUrl', ''),
            array_get($value, 'SRC', ''),
            array_get($value, 'URL', ''),
            array_get($value, 'SHOW_URL', ''),
            array_get($value, 'showUrl', ''),
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
            $absoluteDownloadUrl = absolute_bitrix_file_url($downloadUrl ?: $url, $bitrixDomain);
            $fileName = $name !== '' ? $name : ('File ' . ($id !== '' ? $id : (count($files) + 1)));
            $files[] = [
                'id' => $id !== '' ? (string)$id : (string)(count($files) + 1),
                'name' => $fileName,
                'url' => $absoluteUrl,
                'downloadUrl' => $absoluteDownloadUrl,
                'bitrixUrl' => $absoluteUrl,
                'bitrixDownloadUrl' => $absoluteDownloadUrl,
                'type' => preg_match('/\.(png|jpe?g|webp|gif)$/i', $fileName) || preg_match('/image/i', first_text(array_get($value, 'CONTENT_TYPE', ''), array_get($value, 'type', ''))) ? 'image' : 'file',
            ];
            return;
        }

        foreach ($value as $item) collect_bitrix_deal_files($item, $files, $bitrixDomain);
        return;
    }

    $text = trim((string)$value);
    if (preg_match('/^\d+$/', $text)) {
        $url = absolute_bitrix_file_url('/bitrix/tools/crm_show_file.php?fileId=' . rawurlencode($text), $bitrixDomain);
        $files[] = [
            'id' => $text,
            'name' => 'Bitrix file ' . $text,
            'url' => $url,
            'downloadUrl' => $url,
            'bitrixUrl' => $url,
            'bitrixDownloadUrl' => $url,
            'type' => 'file',
        ];
        return;
    }

    if (preg_match('#^https?://#i', $text) || strpos($text, '/') === 0) {
        $absoluteUrl = absolute_bitrix_file_url($text, $bitrixDomain);
        $name = basename(parse_url($absoluteUrl, PHP_URL_PATH) ?: ('file-' . (count($files) + 1)));
        $files[] = [
            'id' => (string)(count($files) + 1),
            'name' => rawurldecode($name),
            'url' => $absoluteUrl,
            'downloadUrl' => $absoluteUrl,
            'bitrixUrl' => $absoluteUrl,
            'bitrixDownloadUrl' => $absoluteUrl,
            'type' => preg_match('/\.(png|jpe?g|webp|gif)$/i', $name) ? 'image' : 'file',
        ];
    }
}

function bitrix_inline_file_from_value($value, $bitrixDomain, $index)
{
    if (!is_array($value)) return null;
    $inlinePayload = first_defined(
        array_get($value, 'fileData', null),
        array_get($value, 'FILE_DATA', null),
        array_get($value, 'fileBase64', null),
        array_get($value, 'base64', null),
        array_get($value, 'contentBase64', null),
        array_get($value, 'CONTENT_BASE64', null),
        array_get($value, 'dataUrl', null)
    );
    if ($inlinePayload === null || $inlinePayload === '') return null;

    $id = first_text(array_get($value, 'ID', ''), array_get($value, 'id', ''), array_get($value, 'FILE_ID', ''), array_get($value, 'fileId', ''));
    if ($id === '') $id = substr(sha1(json_encode($value) . '|' . $index), 0, 16);
    $name = first_text(
        array_get($value, 'ORIGINAL_NAME', ''),
        array_get($value, 'FILE_NAME', ''),
        array_get($value, 'NAME', ''),
        array_get($value, 'TITLE', ''),
        array_get($value, 'name', ''),
        is_array($inlinePayload) ? array_get($inlinePayload, 0, '') : ''
    );
    if ($name === '') $name = 'Bitrix file ' . $id;
    $mime = first_text(array_get($value, 'CONTENT_TYPE', ''), array_get($value, 'mimeType', ''), array_get($value, 'type', ''));
    $url = absolute_bitrix_file_url('/bitrix/tools/crm_show_file.php?fileId=' . rawurlencode((string)$id), $bitrixDomain);

    return [
        'id' => (string)$id,
        'name' => $name,
        'url' => $url,
        'downloadUrl' => $url,
        'bitrixUrl' => $url,
        'bitrixDownloadUrl' => $url,
        'mimeType' => $mime,
        'type' => preg_match('/\.(png|jpe?g|webp|gif)$/i', $name) || preg_match('/image/i', $mime) ? 'image' : 'file',
        'fileData' => $inlinePayload,
    ];
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
