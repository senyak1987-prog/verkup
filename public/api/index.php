<?php
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_FILES = 8;

$rootDir = dirname(__DIR__);
$dataDir = $rootDir . DIRECTORY_SEPARATOR . 'data';
$uploadsDir = $rootDir . DIRECTORY_SEPARATOR . 'uploads';

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: ' . allowed_origin());
    header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    http_response_code(204);
    exit;
}

header('Access-Control-Allow-Origin: ' . allowed_origin());

ensure_runtime_dirs($dataDir, $uploadsDir);

$method = array_get($_SERVER, 'REQUEST_METHOD', 'GET');
$path = request_path();

try {
    if ($method === 'GET' && $path === '/health') {
        json_response(['ok' => true, 'storage' => 'beget']);
    }

    if ($method === 'GET' && preg_match('#^/data/([a-z0-9_-]+\.json)$#i', $path, $match)) {
        json_response(read_data_file($match[1]), 200);
    }

    if ($method === 'GET' && preg_match('#^/deals/([^/]+)/photos$#', $path, $match)) {
        $dealId = sanitize_segment($match[1]);
        $production = read_production();
        json_response(['success' => true, 'photos' => photos_for_deal($production, $dealId)]);
    }

    if ($method === 'GET' && $path === '/notifications') {
        $production = read_production();
        json_response([
            'success' => true,
            'notifications' => array_values(array_get($production, 'notifications', [])),
        ]);
    }

    if ($method === 'GET' && $path === '/installations') {
        json_response(['success' => true, 'data' => read_installations()]);
    }

    if ($method === 'GET' && $path === '/geocode') {
        json_response(geocode_address((string)array_get($_GET, 'geocode', '')), 200);
    }

    if ($method === 'GET' && $path === '/warehouse') {
        json_response(['success' => true, 'data' => read_warehouse()]);
    }

    if ($method === 'POST' && $path === '/save-production') {
        $body = request_json();
        $incoming = is_array(array_get($body, 'data', null)) ? $body['data'] : [];
        $incoming = normalize_production($incoming);
        $current = read_production();
        $next = normalize_production(merge_production($current, $incoming));
        write_data_file('production.json', $next);
        json_response(['ok' => true, 'data' => $next]);
    }

    if ($method === 'POST' && $path === '/save-installations') {
        $body = request_json();
        $incoming = is_array(array_get($body, 'data', null)) ? $body['data'] : [];
        $current = read_installations();
        $next = normalize_installations(merge_installations($current, $incoming));
        write_data_file('installations.json', $next);
        json_response(['ok' => true, 'data' => $next]);
    }

    if ($method === 'POST' && $path === '/save-tech-specs') {
        $body = request_json();
        $data = is_array(array_get($body, 'data', null)) ? $body['data'] : [];
        if (isset($data['__production']) && is_array($data['__production'])) {
            $data['__production'] = normalize_production($data['__production']);
        }
        write_data_file('tech-specs.json', $data);
        json_response(['ok' => true]);
    }

    if ($method === 'POST' && $path === '/save-calculations') {
        $body = request_json();
        write_data_file('calculations.json', is_array(array_get($body, 'data', null)) ? $body['data'] : []);
        json_response(['ok' => true]);
    }

    if ($method === 'POST' && $path === '/save-catalogs') {
        $body = request_json();
        write_data_file('catalogs.json', is_array(array_get($body, 'data', null)) ? $body['data'] : []);
        json_response(['ok' => true]);
    }

    if ($method === 'POST' && $path === '/save-warehouse') {
        $body = request_json();
        $data = normalize_warehouse(is_array(array_get($body, 'data', null)) ? $body['data'] : []);
        write_data_file('warehouse.json', $data);
        json_response(['ok' => true, 'data' => $data]);
    }

    if ($method === 'POST' && $path === '/warehouse/documents') {
        json_response(handle_warehouse_document_upload(), 200);
    }

    if ($method === 'POST' && preg_match('#^/deals/([^/]+)/photos$#', $path, $match)) {
        $dealId = sanitize_segment($match[1]);
        json_response(handle_photo_upload($dealId), 200);
    }

    if ($method === 'POST' && $path === '/installations') {
        $body = request_json();
        json_response(create_or_update_installation('', $body), 200);
    }

    if ($method === 'POST' && preg_match('#^/installations/([^/]+)$#', $path, $match)) {
        $installationId = sanitize_segment($match[1]);
        $body = request_json();
        json_response(create_or_update_installation($installationId, $body), 200);
    }

    if ($method === 'POST' && preg_match('#^/installations/([^/]+)/(start|arrive|complete|approve|return|cancel|no-installation)$#', $path, $match)) {
        $installationId = sanitize_segment($match[1]);
        $body = request_json();
        json_response(update_installation_workflow($installationId, $body, $match[2]), 200);
    }

    if ($method === 'POST' && preg_match('#^/installations/([^/]+)/photos$#', $path, $match)) {
        $installationId = sanitize_segment($match[1]);
        json_response(handle_installation_photo_upload($installationId), 200);
    }

    if ($method === 'DELETE' && preg_match('#^/deals/([^/]+)/photos/([^/]+)$#', $path, $match)) {
        $dealId = sanitize_segment($match[1]);
        $photoId = sanitize_segment($match[2]);
        json_response(delete_photo($dealId, $photoId), 200);
    }

    if ($method === 'DELETE' && preg_match('#^/installations/([^/]+)/photos/([^/]+)$#', $path, $match)) {
        $installationId = sanitize_segment($match[1]);
        $photoId = sanitize_segment($match[2]);
        json_response(delete_installation_photo($installationId, $photoId), 200);
    }

    if ($method === 'POST' && preg_match('#^/deals/([^/]+)/start-work$#', $path, $match)) {
        $dealId = sanitize_segment($match[1]);
        $body = request_json();
        json_response(update_assignment_workflow($dealId, $body, 'start'), 200);
    }

    if ($method === 'POST' && preg_match('#^/deals/([^/]+)/complete$#', $path, $match)) {
        $dealId = sanitize_segment($match[1]);
        $body = request_json();
        json_response(update_assignment_workflow($dealId, $body, 'complete'), 200);
    }

    if ($method === 'POST' && preg_match('#^/notifications/([^/]+)/read$#', $path, $match)) {
        $notificationId = sanitize_segment($match[1]);
        $body = request_json();
        json_response(mark_notification_read($notificationId, $body), 200);
    }

    if ($method === 'POST' && preg_match('#^/installation-notifications/([^/]+)/read$#', $path, $match)) {
        $notificationId = sanitize_segment($match[1]);
        $body = request_json();
        json_response(mark_installation_notification_read($notificationId, $body), 200);
    }

    if ($method === 'POST' && $path === '/migrate-dataurl-photos') {
        $production = normalize_production(read_production());
        write_data_file('production.json', $production);
        json_response(['ok' => true, 'data' => $production]);
    }

    json_response(['error' => 'Not found', 'path' => $path], 404);
} catch (Exception $error) {
    json_response(['error' => $error->getMessage()], 500);
}

function array_get($array, $key, $default = null)
{
    return is_array($array) && array_key_exists($key, $array) ? $array[$key] : $default;
}

function array_deep_get($array, $keys, $default = null)
{
    $cursor = $array;
    foreach ($keys as $key) {
        if (!is_array($cursor) || !array_key_exists($key, $cursor)) return $default;
        $cursor = $cursor[$key];
    }
    return $cursor;
}

function first_defined()
{
    foreach (func_get_args() as $value) {
        if ($value !== null && $value !== '') return $value;
    }
    return null;
}

function random_hex($bytes)
{
    if (function_exists('openssl_random_pseudo_bytes')) {
        return bin2hex(openssl_random_pseudo_bytes($bytes));
    }
    $raw = '';
    for ($index = 0; $index < $bytes; $index += 1) {
        $raw .= chr(mt_rand(0, 255));
    }
    return bin2hex($raw);
}

function allowed_origin()
{
    $origin = array_get($_SERVER, 'HTTP_ORIGIN', '');
    if ($origin && preg_match('#^https?://([a-z0-9.-]+\.)?verkup\.ru$#i', $origin)) return $origin;
    if ($origin && preg_match('#^https?://kuporoi4\.beget\.tech$#i', $origin)) return $origin;
    return '*';
}

function request_path()
{
    $uri = parse_url(array_get($_SERVER, 'REQUEST_URI', '/'), PHP_URL_PATH) ?: '/';
    $pos = strpos($uri, '/api');
    if ($pos !== false) {
        $path = substr($uri, $pos + 4);
        return $path === '' ? '/' : $path;
    }
    $script = dirname(array_get($_SERVER, 'SCRIPT_NAME', '/api/index.php'));
    $path = substr($uri, strlen($script));
    return $path === false || $path === '' ? '/' : $path;
}

function public_prefix()
{
    $script = str_replace('\\', '/', dirname(array_get($_SERVER, 'SCRIPT_NAME', '/api/index.php')));
    $pos = strpos($script, '/api');
    $prefix = $pos === false ? '' : substr($script, 0, $pos);
    return $prefix === '/' ? '' : rtrim($prefix, '/');
}

function ensure_runtime_dirs($dataDir, $uploadsDir)
{
    if (!is_dir($dataDir) && !mkdir($dataDir, 0755, true)) {
        throw new RuntimeException('Cannot create data directory');
    }
    if (!is_dir($uploadsDir) && !mkdir($uploadsDir, 0755, true)) {
        throw new RuntimeException('Cannot create uploads directory');
    }
    ensure_uploads_htaccess($uploadsDir);
}

function ensure_uploads_htaccess($uploadsDir)
{
    $path = $uploadsDir . DIRECTORY_SEPARATOR . '.htaccess';
    if (is_file($path)) return;
    $content = implode("\n", [
        'Options -Indexes',
        '<FilesMatch "\\.(php|phtml|phar|cgi|pl|py|sh|js|html?|shtml)$">',
        '  Require all denied',
        '</FilesMatch>',
        'RemoveHandler .php .phtml .php3 .php4 .php5 .php7 .php8 .phar',
        'RemoveType .php .phtml .php3 .php4 .php5 .php7 .php8 .phar',
        '',
    ]);
    @file_put_contents($path, $content);
}

function request_json()
{
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') return [];
    $json = json_decode($raw, true);
    if (!is_array($json)) {
        throw new RuntimeException('Invalid JSON body');
    }
    return $json;
}

function json_response($payload, $status = 200)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function data_path($name)
{
    global $dataDir;
    if (!preg_match('/^[a-z0-9_-]+\.json$/i', $name)) {
        throw new RuntimeException('Invalid data file name');
    }
    return $dataDir . DIRECTORY_SEPARATOR . $name;
}

function read_data_file($name)
{
    $path = data_path($name);
    if (!is_file($path)) return default_data($name);
    $raw = file_get_contents($path);
    $json = json_decode($raw ?: '', true);
    return is_array($json) ? $json : default_data($name);
}

function geocode_address($address)
{
    $normalized = trim((string)$address);
    if ($normalized === '') {
        return ['success' => false, 'error' => 'Empty address'];
    }
    $apiKey = yandex_geocoder_api_key();
    if ($apiKey === '') {
        return ['success' => false, 'error' => 'Geocoder key is not configured'];
    }

    $spaced = preg_replace('/([A-Za-zА-Яа-яЁё])(\d)/u', '$1 $2', $normalized);
    $hasRegionHint = preg_match('/[,]|москва|область|край|республика|санкт|г\./iu', $normalized);
    $candidates = $hasRegionHint
        ? [$normalized, $spaced]
        : ['Москва, ' . $spaced, 'Московская область, ' . $spaced, $normalized, $spaced];
    $candidates = array_values(array_unique($candidates));

    foreach ($candidates as $candidate) {
        $url = 'https://geocode-maps.yandex.ru/1.x/?' . http_build_query([
            'apikey' => $apiKey,
            'format' => 'json',
            'geocode' => $candidate,
            'results' => 1,
        ]);
        $raw = geocoder_http_get($url);
        if (!$raw) continue;
        $data = json_decode($raw, true);
        $pos = array_deep_get($data, ['response', 'GeoObjectCollection', 'featureMember', 0, 'GeoObject', 'Point', 'pos'], '');
        if (!is_string($pos) || $pos === '') continue;
        $parts = preg_split('/\s+/', trim($pos));
        if (count($parts) < 2) continue;
        $lon = (float)$parts[0];
        $lat = (float)$parts[1];
        if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) continue;
        return [
            'success' => true,
            'address' => $candidate,
            'coordinates' => [$lat, $lon],
        ];
    }

    return ['success' => false, 'error' => 'Address not found'];
}

function geocoder_http_get($url)
{
    $referer = 'https://manager.verkup.ru/verkup/';
    $context = stream_context_create([
        'http' => [
            'header' => "Referer: {$referer}\r\nUser-Agent: Verkup/1.0\r\n",
            'ignore_errors' => true,
            'timeout' => 8,
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);
    $raw = @file_get_contents($url, false, $context);
    if ($raw) return $raw;

    if (!function_exists('curl_init')) return '';
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_HTTPHEADER => [
            "Referer: {$referer}",
            'User-Agent: Verkup/1.0',
        ],
    ]);
    $response = curl_exec($curl);
    curl_close($curl);
    return is_string($response) ? $response : '';
}

function yandex_geocoder_api_key()
{
    $env = trim((string)getenv('YANDEX_GEOCODER_API_KEY'));
    if ($env !== '') return $env;
    $configPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'config.js';
    if (!is_file($configPath)) return '';
    $raw = file_get_contents($configPath) ?: '';
    if (preg_match('/YANDEX_GEOCODER_API_KEY\s*:\s*"([^"]+)"/', $raw, $match)) {
        return trim((string)$match[1]);
    }
    return '';
}

function write_data_file($name, $data)
{
    $path = data_path($name);
    $tmp = $path . '.tmp';
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    $lockPath = $path . '.lock';
    $lock = fopen($lockPath, 'c');
    if (!$lock) throw new RuntimeException('Cannot open data lock');
    try {
        if (!flock($lock, LOCK_EX)) throw new RuntimeException('Cannot lock data file');
        if (file_put_contents($tmp, $json, LOCK_EX) === false) {
            throw new RuntimeException('Cannot write data file');
        }
        if (!rename($tmp, $path)) throw new RuntimeException('Cannot replace data file');
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function default_data($name)
{
    $now = gmdate('c');
    if ($name === 'production.json') {
        return [
            'generatedAt' => $now,
            'employees' => [],
            'registrations' => [],
            'registrationLinks' => [],
            'assignments' => [],
            'payouts' => [],
            'notifications' => [],
        ];
    }
    if ($name === 'tech-specs.json') return ['generatedAt' => $now, 'specs' => []];
    if ($name === 'calculations.json') return ['generatedAt' => $now, 'agentCostRatio' => 0.58, 'calculations' => []];
    if ($name === 'installations.json') return ['generatedAt' => $now, 'installations' => [], 'notifications' => []];
    if ($name === 'warehouse.json') {
        return [
            'generatedAt' => $now,
            'items' => [],
            'transactions' => [],
            'receipts' => [],
            'issues' => [],
            'documents' => [],
            'priceProposals' => [],
            'materialAliases' => [],
            'priceHistory' => [],
        ];
    }
    if ($name === 'catalogs.json' || $name === 'deals.json') return ['generatedAt' => $now, 'items' => []];
    return [];
}

function read_production()
{
    $data = read_data_file('production.json');
    $data += default_data('production.json');
    if (!isset($data['notifications']) || !is_array($data['notifications'])) $data['notifications'] = [];
    return $data;
}

function merge_production($base, $incoming)
{
    $preferIncoming = is_newer(array_get($incoming, 'generatedAt', ''), array_get($base, 'generatedAt', ''));
    return array_merge($base, [
        'generatedAt' => $preferIncoming ? (array_get($incoming, 'generatedAt', gmdate('c'))) : (array_get($base, 'generatedAt', gmdate('c'))),
        'employees' => merge_records(array_get($base, 'employees', []), array_get($incoming, 'employees', []), $preferIncoming),
        'registrations' => merge_records(array_get($base, 'registrations', []), array_get($incoming, 'registrations', []), $preferIncoming),
        'registrationLinks' => merge_records(array_get($base, 'registrationLinks', []), array_get($incoming, 'registrationLinks', []), $preferIncoming),
        'assignments' => merge_records(array_get($base, 'assignments', []), array_get($incoming, 'assignments', []), $preferIncoming),
        'payouts' => merge_records(array_get($base, 'payouts', []), array_get($incoming, 'payouts', []), $preferIncoming),
        'notifications' => merge_records(array_get($base, 'notifications', []), array_get($incoming, 'notifications', []), $preferIncoming),
    ]);
}

function read_installations()
{
    return normalize_installations(read_data_file('installations.json') + default_data('installations.json'));
}

function read_warehouse()
{
    return normalize_warehouse(read_data_file('warehouse.json') + default_data('warehouse.json'));
}

function normalize_warehouse($data)
{
    if (!is_array($data)) $data = [];
    $data += default_data('warehouse.json');
    foreach (['items', 'transactions', 'receipts', 'issues', 'documents', 'priceProposals', 'materialAliases', 'priceHistory'] as $key) {
        if (!isset($data[$key]) || !is_array($data[$key])) $data[$key] = [];
    }
    if (!isset($data['generatedAt']) || !$data['generatedAt']) $data['generatedAt'] = gmdate('c');
    return $data;
}

function merge_installations($base, $incoming)
{
    $preferIncoming = is_newer(array_get($incoming, 'generatedAt', ''), array_get($base, 'generatedAt', ''));
    return array_merge($base, [
        'generatedAt' => $preferIncoming ? (array_get($incoming, 'generatedAt', gmdate('c'))) : (array_get($base, 'generatedAt', gmdate('c'))),
        'installations' => merge_records(array_get($base, 'installations', []), array_get($incoming, 'installations', []), $preferIncoming),
        'notifications' => merge_records(array_get($base, 'notifications', []), array_get($incoming, 'notifications', []), $preferIncoming),
    ]);
}

function normalize_installations($data)
{
    if (!is_array($data)) $data = [];
    $data += default_data('installations.json');
    if (!isset($data['installations']) || !is_array($data['installations'])) $data['installations'] = [];
    if (!isset($data['notifications']) || !is_array($data['notifications'])) $data['notifications'] = [];
    foreach ($data['installations'] as &$installation) {
        if (!is_array($installation)) continue;
        if (!isset($installation['photos']) || !is_array($installation['photos'])) $installation['photos'] = [];
        if (!isset($installation['history']) || !is_array($installation['history'])) $installation['history'] = [];
        if (!isset($installation['sourceFiles']) || !is_array($installation['sourceFiles'])) $installation['sourceFiles'] = [];
        if (empty($installation['status'])) $installation['status'] = empty($installation['installerId']) ? 'not_scheduled' : 'assigned';
        if (empty($installation['updatedAt'])) $installation['updatedAt'] = array_get($installation, 'createdAt', gmdate('c'));
    }
    unset($installation);
    return $data;
}

function create_or_update_installation($installationId, $body)
{
    $store = read_installations();
    $now = gmdate('c');
    $actor = trim((string)(array_get($body, 'actor', '')));
    $actorId = sanitize_segment((string)(array_get($body, 'actorId', '')));
    $dealId = sanitize_segment((string)(array_get($body, 'dealId', '')));
    $foundIndex = -1;

    if ($installationId !== '') {
        foreach ($store['installations'] as $index => $installation) {
            if (is_array($installation) && (string)(array_get($installation, 'id', '')) === $installationId) {
                $foundIndex = $index;
                break;
            }
        }
    }

    $current = $foundIndex >= 0 ? $store['installations'][$foundIndex] : [];
    if ($dealId === '' || $dealId === 'unknown') {
        $dealId = sanitize_segment((string)(array_get($current, 'dealId', '')));
    }
    if ($dealId === '' || $dealId === 'unknown') throw new RuntimeException('Deal is required');

    $id = $installationId !== '' ? $installationId : ('inst_' . gmdate('Ymd_His') . '_' . random_hex(4));
    $status = trim((string)(array_get($body, 'status', array_get($current, 'status', ''))));
    if ($status === '') {
        $status = trim((string)(array_get($body, 'installerId', array_get($current, 'installerId', '')))) !== '' ? 'assigned' : 'not_scheduled';
    }

    $installation = array_merge($current, [
        'id' => $id,
        'dealId' => $dealId,
        'dealNumber' => trim((string)(array_get($body, 'dealNumber', array_get($current, 'dealNumber', '')))),
        'dealTitle' => trim((string)(array_get($body, 'dealTitle', array_get($current, 'dealTitle', '')))),
        'date' => trim((string)(array_get($body, 'date', array_get($current, 'date', '')))),
        'timeFrom' => trim((string)(array_get($body, 'timeFrom', array_get($current, 'timeFrom', '')))),
        'timeTo' => trim((string)(array_get($body, 'timeTo', array_get($current, 'timeTo', '')))),
        'address' => trim((string)(array_get($body, 'address', array_get($current, 'address', '')))),
        'installerId' => sanitize_segment((string)(array_get($body, 'installerId', array_get($current, 'installerId', '')))),
        'installerName' => trim((string)(array_get($body, 'installerName', array_get($current, 'installerName', '')))),
        'status' => $status,
        'addressEdited' => (bool)array_get($body, 'addressEdited', array_get($current, 'addressEdited', false)),
        'addressSource' => trim((string)(array_get($body, 'addressSource', array_get($current, 'addressSource', '')))),
        'clientName' => trim((string)(array_get($body, 'clientName', array_get($current, 'clientName', '')))),
        'clientPhone' => trim((string)(array_get($body, 'clientPhone', array_get($current, 'clientPhone', '')))),
        'comment' => trim((string)(array_get($body, 'comment', array_get($current, 'comment', '')))),
        'resultComment' => trim((string)(array_get($body, 'resultComment', array_get($current, 'resultComment', '')))),
        'returnComment' => trim((string)(array_get($body, 'returnComment', array_get($current, 'returnComment', '')))),
        'sourceFiles' => is_array(array_get($body, 'sourceFiles', null)) ? array_values($body['sourceFiles']) : (is_array(array_get($current, 'sourceFiles', null)) ? $current['sourceFiles'] : []),
        'photos' => is_array(array_get($current, 'photos', null)) ? $current['photos'] : [],
        'history' => is_array(array_get($current, 'history', null)) ? $current['history'] : [],
        'createdAt' => array_get($current, 'createdAt', $now),
        'createdBy' => array_get($current, 'createdBy', $actor),
        'updatedAt' => $now,
    ]);

    $installation['history'][] = installation_event($foundIndex >= 0 ? 'updated' : 'created', $actor, $actorId, array_get($body, 'note', ''));
    if ($installation['installerId'] !== '' && $status === 'assigned') {
        $store['notifications'][] = installation_notification('assigned', $installation, $actor, $actorId, $installation['installerId']);
    }

    if ($foundIndex >= 0) $store['installations'][$foundIndex] = $installation;
    else $store['installations'][] = $installation;

    $store['generatedAt'] = $now;
    write_data_file('installations.json', normalize_installations($store));
    $data = read_installations();
    $saved = installation_by_id($data, $id);
    return ['success' => true, 'installation' => $saved, 'data' => $data];
}

function update_installation_workflow($installationId, $body, $action)
{
    $store = read_installations();
    $now = gmdate('c');
    $actor = trim((string)(array_get($body, 'actor', '')));
    $actorId = sanitize_segment((string)(array_get($body, 'actorId', '')));
    $installerLocation = sanitize_installation_location(array_get($body, 'installerLocation', null));
    $updated = false;

    foreach ($store['installations'] as &$installation) {
        if (!is_array($installation) || (string)(array_get($installation, 'id', '')) !== $installationId) continue;
        if ($action === 'start') {
            $installation['status'] = 'in_progress';
            if (empty($installation['startedAt'])) $installation['startedAt'] = $now;
            if ($installerLocation) $installation['installerLocation'] = $installerLocation;
            $installation['history'][] = installation_event('started', $actor, $actorId, array_get($body, 'note', ''));
            $store['notifications'][] = installation_notification('started', $installation, $actor, $actorId, '');
        } elseif ($action === 'arrive') {
            $installation['status'] = 'arrived';
            $installation['arrivedAt'] = $now;
            if ($installerLocation) $installation['installerLocation'] = $installerLocation;
            $installation['history'][] = installation_event('arrived', $actor, $actorId, array_get($body, 'note', ''));
            $store['notifications'][] = installation_notification('arrived', $installation, $actor, $actorId, '');
        } elseif ($action === 'complete') {
            $installation['status'] = 'review_pending';
            $installation['completedAt'] = $now;
            $installation['resultComment'] = trim((string)(array_get($body, 'resultComment', array_get($installation, 'resultComment', ''))));
            $installation['history'][] = installation_event('completed', $actor, $actorId, array_get($body, 'note', ''));
            $store['notifications'][] = installation_notification('completed', $installation, $actor, $actorId, '');
        } elseif ($action === 'approve') {
            $installation['status'] = 'completed';
            $installation['approvedAt'] = $now;
            $installation['history'][] = installation_event('approved', $actor, $actorId, array_get($body, 'note', ''));
            $store['notifications'][] = installation_notification('approved', $installation, $actor, $actorId, array_get($installation, 'installerId', ''));
        } elseif ($action === 'return') {
            $installation['status'] = 'needs_revision';
            $installation['returnComment'] = trim((string)(array_get($body, 'returnComment', array_get($body, 'note', ''))));
            $installation['history'][] = installation_event('returned', $actor, $actorId, array_get($body, 'note', ''));
            $store['notifications'][] = installation_notification('needsRevision', $installation, $actor, $actorId, array_get($installation, 'installerId', ''));
        } elseif ($action === 'cancel') {
            $installation['status'] = 'canceled';
            $installation['history'][] = installation_event('canceled', $actor, $actorId, array_get($body, 'note', ''));
        } elseif ($action === 'no-installation') {
            $installation['status'] = 'no_installation';
            $installation['history'][] = installation_event('noInstallation', $actor, $actorId, array_get($body, 'note', ''));
        }
        $installation['updatedAt'] = $now;
        $updated = true;
        break;
    }
    unset($installation);

    if (!$updated) throw new RuntimeException('Installation not found');

    $store['generatedAt'] = $now;
    write_data_file('installations.json', normalize_installations($store));
    $data = read_installations();
    return ['success' => true, 'installation' => installation_by_id($data, $installationId), 'data' => $data];
}

function installation_event($type, $actor, $actorId, $note)
{
    return [
        'id' => 'event_' . gmdate('Ymd_His') . '_' . random_hex(4),
        'type' => $type,
        'at' => gmdate('c'),
        'actor' => $actor,
        'actorId' => $actorId,
        'note' => trim((string)$note),
    ];
}

function installation_notification($type, $installation, $actor, $actorId, $targetEmployeeId)
{
    $number = array_get($installation, 'dealNumber', '') ?: array_get($installation, 'dealId', '');
    $time = trim((string)(array_get($installation, 'timeFrom', '')));
    $messages = [
        'assigned' => "Вам назначен монтаж по сделке #{$number}" . ($time ? " на {$time}" : ""),
        'started' => "Монтажник начал работу по сделке #{$number}",
        'arrived' => "Монтажник на месте по сделке #{$number}",
        'photoAdded' => "По монтажу #{$number} добавлены фото",
        'completed' => "Монтаж по сделке #{$number} завершен. Нужно проверить",
        'approved' => "Монтаж по сделке #{$number} проверен",
        'needsRevision' => "Монтаж по сделке #{$number} возвращен на доработку",
        'problem' => "Проблема на монтаже по сделке #{$number}",
    ];
    return [
        'id' => 'inst_notice_' . gmdate('Ymd_His') . '_' . random_hex(4),
        'type' => $type,
        'installationId' => array_get($installation, 'id', ''),
        'dealId' => array_get($installation, 'dealId', ''),
        'dealNumber' => array_get($installation, 'dealNumber', ''),
        'dealTitle' => array_get($installation, 'dealTitle', ''),
        'message' => isset($messages[$type]) ? $messages[$type] : "Событие по монтажу #{$number}",
        'actor' => $actor,
        'actorId' => $actorId,
        'targetEmployeeId' => $targetEmployeeId,
        'createdAt' => gmdate('c'),
        'readBy' => [],
    ];
}

function installation_by_id($store, $installationId)
{
    foreach (array_get($store, 'installations', []) as $installation) {
        if (is_array($installation) && (string)(array_get($installation, 'id', '')) === $installationId) return $installation;
    }
    return null;
}

function merge_records($baseRecords, $incomingRecords, $preferIncoming)
{
    $records = [];
    foreach ($baseRecords as $record) {
        if (is_array($record) && isset($record['id'])) $records[(string)$record['id']] = $record;
    }
    foreach ($incomingRecords as $record) {
        if (!is_array($record) || !isset($record['id'])) continue;
        $key = (string)$record['id'];
        if ($preferIncoming || !isset($records[$key])) $records[$key] = $record;
    }
    return array_values($records);
}

function is_newer($candidate, $baseline)
{
    $candidateTs = strtotime($candidate);
    $baselineTs = strtotime($baseline);
    return $candidateTs !== false && ($baselineTs === false || $candidateTs > $baselineTs);
}

function normalize_production($production)
{
    if (!isset($production['assignments']) || !is_array($production['assignments'])) return $production;
    foreach ($production['assignments'] as &$assignment) {
        if (!is_array($assignment)) continue;
        if (!isset($assignment['completion']) || !is_array($assignment['completion'])) continue;
        $photos = array_deep_get($assignment, ['completion', 'photos'], []);
        if (!is_array($photos)) $photos = [];
        foreach ($photos as &$photo) {
            if (is_array($photo) && !empty($photo['dataUrl']) && is_string($photo['dataUrl'])) {
                $photo = migrate_data_url_photo($photo, $assignment);
            }
        }
        unset($photo);
        $assignment['completion']['photos'] = $photos;
    }
    unset($assignment);
    if (!isset($production['notifications']) || !is_array($production['notifications'])) {
        $production['notifications'] = [];
    }
    return $production;
}

function migrate_data_url_photo($photo, $assignment)
{
    $dataUrl = (string)(array_get($photo, 'dataUrl', ''));
    if (!preg_match('#^data:(image/[a-z0-9.+-]+);base64,(.+)$#i', $dataUrl, $match)) {
        unset($photo['dataUrl']);
        return $photo;
    }
    $mime = strtolower($match[1]);
    $bytes = base64_decode($match[2], true);
    if ($bytes === false) {
        unset($photo['dataUrl']);
        return $photo;
    }
    $dealId = sanitize_segment((string)(first_defined(array_get($photo, 'dealId', null), array_get($assignment, 'dealId', null), 'unknown')));
    $ext = extension_for_mime($mime) ?: 'jpg';
    $id = (string)(array_get($photo, 'id', ('photo_' . random_hex(8))));
    $safeId = sanitize_segment($id);
    $stored = store_photo_bytes($dealId, $safeId, $bytes, $ext, $mime);
    unset($photo['dataUrl']);
    return array_merge($photo, [
        'id' => $safeId,
        'url' => $stored['url'],
        'thumbnailUrl' => $stored['thumbnailUrl'],
        'mimeType' => $mime,
        'size' => strlen($bytes),
    ]);
}

function normalize_assignment_completion_payload($completion, $assignment)
{
    if (!is_array($completion)) {
        $current = array_get($assignment, 'completion', []);
        return is_array($current) ? $current : [];
    }

    $photos = array_get($completion, 'photos', []);
    if (!is_array($photos)) $photos = [];
    foreach ($photos as &$photo) {
        if (is_array($photo) && !empty($photo['dataUrl']) && is_string($photo['dataUrl'])) {
            $photo = migrate_data_url_photo($photo, $assignment);
        }
    }
    unset($photo);
    $completion['photos'] = $photos;
    return $completion;
}

function handle_photo_upload($dealId)
{
    $files = normalize_uploaded_files();
    if (!$files) throw new RuntimeException('No files uploaded');
    if (count($files) > MAX_UPLOAD_FILES) throw new RuntimeException('Too many files');

    $assignmentId = sanitize_segment((string)(array_get($_POST, 'assignmentId', '')));
    $employeeId = sanitize_segment((string)(array_get($_POST, 'employeeId', '')));
    $kind = sanitize_segment((string)(array_get($_POST, 'kind', 'photo')));
    $uploadedBy = trim((string)(array_get($_POST, 'uploadedBy', '')));
    $dealNumber = trim((string)(array_get($_POST, 'dealNumber', '')));
    $dealTitle = trim((string)(array_get($_POST, 'dealTitle', '')));
    $techSpecItemId = sanitize_segment((string)(array_get($_POST, 'techSpecItemId', '')));

    $photos = [];
    foreach ($files as $file) {
        $photos[] = save_uploaded_photo($dealId, $file, [
            'assignmentId' => $assignmentId,
            'employeeId' => $employeeId,
            'kind' => $kind,
            'uploadedBy' => $uploadedBy,
            'dealNumber' => $dealNumber,
            'dealTitle' => $dealTitle,
            'techSpecItemId' => $techSpecItemId,
        ]);
    }

    $production = read_production();
    $assignmentUpdated = false;
    foreach ($production['assignments'] as &$assignment) {
        if (!is_array($assignment)) continue;
        $matchesAssignment = $assignmentId && (string)(array_get($assignment, 'id', '')) === $assignmentId;
        $matchesDealEmployee = !$assignmentId &&
            (string)(array_get($assignment, 'dealId', '')) === $dealId &&
            (!$employeeId || (string)(array_get($assignment, 'employeeId', '')) === $employeeId);
        if (!$matchesAssignment && !$matchesDealEmployee) continue;

        if (!isset($assignment['completion']) || !is_array($assignment['completion'])) {
            $assignment['completion'] = ['photos' => []];
        }
        if (!isset($assignment['completion']['photos']) || !is_array($assignment['completion']['photos'])) {
            $assignment['completion']['photos'] = [];
        }
        $assignment['completion']['photos'] = array_values(array_filter(
            $assignment['completion']['photos'],
            function ($photo) use ($kind) {
                return !is_array($photo) || ((array_get($photo, 'kind', '')) !== $kind);
            }
        ));
        foreach ($photos as $photo) $assignment['completion']['photos'][] = $photo;
        $assignment['workerStatus'] = 'photosAdded';
        $assignment['photosAddedAt'] = gmdate('c');
        $assignmentUpdated = true;
        break;
    }
    unset($assignment);

    $production['generatedAt'] = gmdate('c');
    $production['notifications'][] = notification_record('photosAdded', $dealId, $dealNumber, $dealTitle, $uploadedBy);
    write_data_file('production.json', normalize_production($production));

    return [
        'success' => true,
        'assignmentUpdated' => $assignmentUpdated,
        'photos' => $photos,
    ];
}

function handle_installation_photo_upload($installationId)
{
    $files = normalize_uploaded_files();
    if (!$files) throw new RuntimeException('No files uploaded');
    if (count($files) > MAX_UPLOAD_FILES) throw new RuntimeException('Too many files');

    $actor = trim((string)(array_get($_POST, 'actor', '')));
    $actorId = sanitize_segment((string)(array_get($_POST, 'actorId', '')));
    $dealId = sanitize_segment((string)(array_get($_POST, 'dealId', '')));
    $type = sanitize_segment((string)(array_get($_POST, 'type', 'after')));

    $store = read_installations();
    $photos = [];
    $updated = false;

    foreach ($store['installations'] as &$installation) {
        if (!is_array($installation) || (string)(array_get($installation, 'id', '')) !== $installationId) continue;
        if ($dealId === '' || $dealId === 'unknown') $dealId = sanitize_segment((string)(array_get($installation, 'dealId', '')));
        if (!isset($installation['photos']) || !is_array($installation['photos'])) $installation['photos'] = [];
        foreach ($files as $file) {
            $photo = save_uploaded_installation_photo($installationId, $dealId, $file, [
                'actor' => $actor,
                'actorId' => $actorId,
                'type' => $type,
            ]);
            $installation['photos'][] = $photo;
            $photos[] = $photo;
        }
        if (!isset($installation['history']) || !is_array($installation['history'])) $installation['history'] = [];
        $installation['history'][] = installation_event('photoAdded', $actor, $actorId, '');
        if ((string)(array_get($installation, 'status', '')) === 'assigned') $installation['status'] = 'in_progress';
        $installation['updatedAt'] = gmdate('c');
        $store['notifications'][] = installation_notification('photoAdded', $installation, $actor, $actorId, '');
        $updated = true;
        break;
    }
    unset($installation);

    if (!$updated) throw new RuntimeException('Installation not found');

    $store['generatedAt'] = gmdate('c');
    write_data_file('installations.json', normalize_installations($store));
    $data = read_installations();
    return [
        'success' => true,
        'installation' => installation_by_id($data, $installationId),
        'photos' => $photos,
        'data' => $data,
    ];
}

function handle_warehouse_document_upload()
{
    $files = normalize_uploaded_files();
    if (!$files) throw new RuntimeException('No files uploaded');
    if (count($files) > MAX_UPLOAD_FILES) throw new RuntimeException('Too many files');

    $actor = trim((string)(array_get($_POST, 'actor', '')));
    $requestedType = sanitize_segment((string)(array_get($_POST, 'type', '')));
    $warehouse = read_warehouse();
    $documents = [];

    foreach ($files as $file) {
        $documents[] = save_uploaded_warehouse_document($file, $actor, $requestedType);
    }

    $warehouse['documents'] = array_values(array_merge(array_get($warehouse, 'documents', []), $documents));
    $warehouse['generatedAt'] = gmdate('c');
    write_data_file('warehouse.json', normalize_warehouse($warehouse));

    return [
        'success' => true,
        'documents' => $documents,
        'data' => read_warehouse(),
    ];
}

function normalize_uploaded_files()
{
    $input = isset($_FILES['files']) ? $_FILES['files'] : (isset($_FILES['photo']) ? $_FILES['photo'] : null);
    if (!$input) return [];
    if (is_array($input['name'])) {
        $files = [];
        foreach ($input['name'] as $index => $name) {
            if ((isset($input['error'][$index]) ? $input['error'][$index] : UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) continue;
            $files[] = [
                'name' => $name,
                'type' => isset($input['type'][$index]) ? $input['type'][$index] : '',
                'tmp_name' => isset($input['tmp_name'][$index]) ? $input['tmp_name'][$index] : '',
                'error' => isset($input['error'][$index]) ? $input['error'][$index] : UPLOAD_ERR_NO_FILE,
                'size' => isset($input['size'][$index]) ? $input['size'][$index] : 0,
            ];
        }
        return $files;
    }
    return [$input];
}

function save_uploaded_photo($dealId, $file, $meta)
{
    if ((array_get($file, 'error', UPLOAD_ERR_NO_FILE)) !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Upload failed with code ' . (string)(array_get($file, 'error', 'unknown')));
    }
    $size = (int)(array_get($file, 'size', 0));
    if ($size <= 0 || $size > MAX_UPLOAD_BYTES) {
        throw new RuntimeException('File is too large or empty');
    }
    $tmp = (string)(array_get($file, 'tmp_name', ''));
    if (!is_uploaded_file($tmp)) {
        throw new RuntimeException('Invalid uploaded file');
    }
    $mime = detect_mime($tmp);
    $ext = extension_for_mime($mime);
    if (!$ext) {
        throw new RuntimeException('Unsupported image format');
    }
    $id = 'photo_' . gmdate('Ymd_His') . '_' . random_hex(4);
    $bytes = file_get_contents($tmp);
    if ($bytes === false) throw new RuntimeException('Cannot read uploaded file');
    $stored = store_photo_bytes($dealId, $id, $bytes, $ext, $mime);
    return [
        'id' => $id,
        'assignmentId' => $meta['assignmentId'] ?: null,
        'dealId' => $dealId,
        'dealNumber' => $meta['dealNumber'] ?: '',
        'dealTitle' => $meta['dealTitle'] ?: '',
        'employeeId' => $meta['employeeId'] ?: '',
        'kind' => $meta['kind'] ?: 'photo',
        'name' => sanitize_original_name((string)(array_get($file, 'name', 'photo'))),
        'originalName' => sanitize_original_name((string)(array_get($file, 'name', 'photo'))),
        'url' => $stored['url'],
        'thumbnailUrl' => $stored['thumbnailUrl'],
        'mimeType' => $mime,
        'size' => $size,
        'techSpecItemId' => $meta['techSpecItemId'] ?: null,
        'uploadedAt' => gmdate('c'),
        'uploadedBy' => $meta['uploadedBy'] ?: '',
    ];
}

function save_uploaded_installation_photo($installationId, $dealId, $file, $meta)
{
    if ((array_get($file, 'error', UPLOAD_ERR_NO_FILE)) !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Upload failed with code ' . (string)(array_get($file, 'error', 'unknown')));
    }
    $size = (int)(array_get($file, 'size', 0));
    if ($size <= 0 || $size > MAX_UPLOAD_BYTES) {
        throw new RuntimeException('File is too large or empty');
    }
    $tmp = (string)(array_get($file, 'tmp_name', ''));
    if (!is_uploaded_file($tmp)) {
        throw new RuntimeException('Invalid uploaded file');
    }
    $mime = detect_mime($tmp);
    $ext = extension_for_mime($mime);
    if (!$ext) {
        throw new RuntimeException('Unsupported image format');
    }
    $id = 'photo_' . gmdate('Ymd_His') . '_' . random_hex(4);
    $bytes = file_get_contents($tmp);
    if ($bytes === false) throw new RuntimeException('Cannot read uploaded file');
    $stored = store_installation_photo_bytes($installationId, $id, $bytes, $ext, $mime);
    return [
        'id' => $id,
        'installationId' => $installationId,
        'dealId' => $dealId,
        'url' => $stored['url'],
        'thumbnailUrl' => $stored['thumbnailUrl'],
        'originalName' => sanitize_original_name((string)(array_get($file, 'name', 'photo'))),
        'mimeType' => $mime,
        'size' => $size,
        'type' => $meta['type'] ?: 'after',
        'uploadedAt' => gmdate('c'),
        'uploadedBy' => $meta['actor'] ?: '',
        'uploadedById' => $meta['actorId'] ?: '',
    ];
}

function save_uploaded_warehouse_document($file, $actor, $requestedType)
{
    if ((array_get($file, 'error', UPLOAD_ERR_NO_FILE)) !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Upload failed with code ' . (string)(array_get($file, 'error', 'unknown')));
    }
    $size = (int)(array_get($file, 'size', 0));
    if ($size <= 0 || $size > MAX_UPLOAD_BYTES) {
        throw new RuntimeException('File is too large or empty');
    }
    $tmp = (string)(array_get($file, 'tmp_name', ''));
    if (!is_uploaded_file($tmp)) {
        throw new RuntimeException('Invalid uploaded file');
    }

    $originalName = sanitize_original_name((string)(array_get($file, 'name', 'invoice')));
    $mime = detect_mime($tmp);
    $ext = warehouse_document_extension($originalName, $mime);
    if (!$ext) throw new RuntimeException('Unsupported warehouse document format');

    $type = warehouse_document_type($ext, $mime, $requestedType);
    $id = 'doc_' . gmdate('Ymd_His') . '_' . random_hex(5);
    $stored = store_warehouse_document_file($id, $tmp, $ext);

    return [
        'id' => $id,
        'type' => $type,
        'originalName' => $originalName,
        'url' => $stored['url'],
        'size' => $size,
        'mimeType' => $mime,
        'uploadedAt' => gmdate('c'),
        'uploadedBy' => $actor,
        'processingStatus' => ($type === 'invoice_excel') ? 'parsed' : 'needs_review',
    ];
}

function store_photo_bytes($dealId, $id, $bytes, $ext, $mime)
{
    global $uploadsDir;
    $dealDir = $uploadsDir . DIRECTORY_SEPARATOR . 'deals' . DIRECTORY_SEPARATOR . $dealId;
    if (!is_dir($dealDir) && !mkdir($dealDir, 0755, true)) {
        throw new RuntimeException('Cannot create deal upload directory');
    }
    $filename = $id . '.' . $ext;
    $path = $dealDir . DIRECTORY_SEPARATOR . $filename;
    if (file_put_contents($path, $bytes, LOCK_EX) === false) {
        throw new RuntimeException('Cannot save photo');
    }
    $thumbName = 'thumb_' . $id . '.jpg';
    $thumbPath = $dealDir . DIRECTORY_SEPARATOR . $thumbName;
    $thumbCreated = create_thumbnail($path, $thumbPath, $mime);
    $prefix = public_prefix();
    $baseUrl = $prefix . '/uploads/deals/' . rawurlencode($dealId) . '/';
    return [
        'url' => $baseUrl . rawurlencode($filename),
        'thumbnailUrl' => $baseUrl . rawurlencode($thumbCreated ? $thumbName : $filename),
    ];
}

function store_installation_photo_bytes($installationId, $id, $bytes, $ext, $mime)
{
    global $uploadsDir;
    $installationDir = $uploadsDir . DIRECTORY_SEPARATOR . 'installations' . DIRECTORY_SEPARATOR . $installationId;
    if (!is_dir($installationDir) && !mkdir($installationDir, 0755, true)) {
        throw new RuntimeException('Cannot create installation upload directory');
    }
    $filename = $id . '.' . $ext;
    $path = $installationDir . DIRECTORY_SEPARATOR . $filename;
    if (file_put_contents($path, $bytes, LOCK_EX) === false) {
        throw new RuntimeException('Cannot save photo');
    }
    $thumbName = 'thumb_' . $id . '.jpg';
    $thumbPath = $installationDir . DIRECTORY_SEPARATOR . $thumbName;
    $thumbCreated = create_thumbnail($path, $thumbPath, $mime);
    $prefix = public_prefix();
    $baseUrl = $prefix . '/uploads/installations/' . rawurlencode($installationId) . '/';
    return [
        'url' => $baseUrl . rawurlencode($filename),
        'thumbnailUrl' => $baseUrl . rawurlencode($thumbCreated ? $thumbName : $filename),
    ];
}

function store_warehouse_document_file($id, $tmp, $ext)
{
    global $uploadsDir;
    $documentDir = $uploadsDir . DIRECTORY_SEPARATOR . 'warehouse' . DIRECTORY_SEPARATOR . 'documents' . DIRECTORY_SEPARATOR . $id;
    if (!is_dir($documentDir) && !mkdir($documentDir, 0755, true)) {
        throw new RuntimeException('Cannot create warehouse document directory');
    }
    $filename = 'invoice.' . $ext;
    $path = $documentDir . DIRECTORY_SEPARATOR . $filename;
    if (!move_uploaded_file($tmp, $path)) {
        throw new RuntimeException('Cannot save warehouse document');
    }
    $prefix = public_prefix();
    return [
        'url' => $prefix . '/uploads/warehouse/documents/' . rawurlencode($id) . '/' . rawurlencode($filename),
    ];
}

function detect_mime($tmp)
{
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    return strtolower((string)$finfo->file($tmp));
}

function extension_for_mime($mime)
{
    switch (strtolower($mime)) {
        case 'image/jpeg':
        case 'image/pjpeg':
            return 'jpg';
        case 'image/png':
            return 'png';
        case 'image/webp':
            return 'webp';
        case 'image/heic':
            return 'heic';
        case 'image/heif':
            return 'heif';
        default:
            return null;
    }
}

function warehouse_document_extension($originalName, $mime)
{
    $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    $allowed = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf', 'xlsx', 'xls', 'csv'];
    if (in_array($ext, $allowed, true)) return $ext === 'jpeg' ? 'jpg' : $ext;

    switch (strtolower($mime)) {
        case 'image/jpeg':
        case 'image/pjpeg':
            return 'jpg';
        case 'image/png':
            return 'png';
        case 'image/webp':
            return 'webp';
        case 'image/heic':
            return 'heic';
        case 'image/heif':
            return 'heif';
        case 'application/pdf':
            return 'pdf';
        case 'text/csv':
        case 'text/plain':
            return 'csv';
        case 'application/vnd.ms-excel':
            return 'xls';
        case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        case 'application/zip':
            return 'xlsx';
        default:
            return null;
    }
}

function warehouse_document_type($ext, $mime, $requestedType)
{
    if (in_array($requestedType, ['invoice_photo', 'invoice_pdf', 'invoice_excel'], true)) return $requestedType;
    if (in_array($ext, ['jpg', 'png', 'webp', 'heic', 'heif'], true) || strpos($mime, 'image/') === 0) return 'invoice_photo';
    if ($ext === 'pdf' || $mime === 'application/pdf') return 'invoice_pdf';
    return 'invoice_excel';
}

function create_thumbnail($source, $target, $mime)
{
    if (!function_exists('imagecreatetruecolor')) return false;
    $image = null;
    if ($mime === 'image/jpeg' || $mime === 'image/pjpeg') $image = @imagecreatefromjpeg($source);
    if ($mime === 'image/png') $image = @imagecreatefrompng($source);
    if ($mime === 'image/webp' && function_exists('imagecreatefromwebp')) $image = @imagecreatefromwebp($source);
    if (!$image) return false;

    $width = imagesx($image);
    $height = imagesy($image);
    $max = 960;
    $ratio = min(1, $max / max(1, $width), $max / max(1, $height));
    $thumbWidth = max(1, (int)round($width * $ratio));
    $thumbHeight = max(1, (int)round($height * $ratio));
    $thumb = imagecreatetruecolor($thumbWidth, $thumbHeight);
    $white = imagecolorallocate($thumb, 255, 255, 255);
    imagefill($thumb, 0, 0, $white);
    imagecopyresampled($thumb, $image, 0, 0, 0, 0, $thumbWidth, $thumbHeight, $width, $height);
    $ok = imagejpeg($thumb, $target, 88);
    imagedestroy($image);
    imagedestroy($thumb);
    return $ok;
}

function sanitize_installation_location($value)
{
    if (!is_array($value)) return null;
    $latRaw = array_get($value, 'lat', null);
    $lonRaw = array_get($value, 'lon', null);
    if (!is_numeric($latRaw) || !is_numeric($lonRaw)) return null;
    $lat = (float)$latRaw;
    $lon = (float)$lonRaw;
    if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) return null;
    $accuracyRaw = array_get($value, 'accuracy', null);
    $capturedAt = trim((string)array_get($value, 'capturedAt', gmdate('c')));
    return [
        'accuracy' => is_numeric($accuracyRaw) ? (float)$accuracyRaw : null,
        'capturedAt' => $capturedAt !== '' ? $capturedAt : gmdate('c'),
        'lat' => $lat,
        'lon' => $lon,
        'source' => 'browser',
    ];
}

function sanitize_segment($value)
{
    $safe = preg_replace('/[^a-zA-Z0-9_.-]+/', '-', trim($value));
    $safe = trim((string)$safe, '.-');
    return $safe !== '' ? substr($safe, 0, 96) : 'unknown';
}

function sanitize_original_name($value)
{
    $value = preg_replace('/[^\pL\pN_. -]+/u', '_', trim($value));
    return substr($value ?: 'photo', 0, 160);
}

function photos_for_deal($production, $dealId)
{
    $photos = [];
    foreach (array_get($production, 'assignments', []) as $assignment) {
        if (!is_array($assignment) || (string)(array_get($assignment, 'dealId', '')) !== $dealId) continue;
        foreach ((array_deep_get($assignment, ['completion', 'photos'], [])) as $photo) {
            if (is_array($photo)) $photos[] = $photo;
        }
    }
    return $photos;
}

function delete_photo($dealId, $photoId)
{
    global $uploadsDir;
    $production = read_production();
    foreach ($production['assignments'] as &$assignment) {
        if (!is_array($assignment) || (string)(array_get($assignment, 'dealId', '')) !== $dealId) continue;
        $photos = array_deep_get($assignment, ['completion', 'photos'], []);
        if (!is_array($photos)) continue;
        foreach ($photos as $photo) {
            if (!is_array($photo) || (string)(array_get($photo, 'id', '')) !== $photoId) continue;
            foreach (['url', 'thumbnailUrl'] as $key) {
                if (!empty($photo[$key])) {
                    $relative = parse_url((string)$photo[$key], PHP_URL_PATH);
                    $marker = '/uploads/';
                    $pos = strpos((string)$relative, $marker);
                    if ($pos !== false) {
                        $path = $uploadsDir . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, substr((string)$relative, $pos + strlen($marker)));
                        if (is_file($path)) @unlink($path);
                    }
                }
            }
        }
        $assignment['completion']['photos'] = array_values(array_filter(
            $photos,
            function ($photo) use ($photoId) {
                return !is_array($photo) || (string)(array_get($photo, 'id', '')) !== $photoId;
            }
        ));
    }
    unset($assignment);
    $production['generatedAt'] = gmdate('c');
    write_data_file('production.json', $production);
    return ['success' => true];
}

function delete_installation_photo($installationId, $photoId)
{
    global $uploadsDir;
    $store = read_installations();
    $target = null;
    foreach ($store['installations'] as &$installation) {
        if (!is_array($installation) || (string)(array_get($installation, 'id', '')) !== $installationId) continue;
        $photos = array_get($installation, 'photos', []);
        if (!is_array($photos)) $photos = [];
        foreach ($photos as $photo) {
            if (!is_array($photo) || (string)(array_get($photo, 'id', '')) !== $photoId) continue;
            $target = $photo;
            foreach (['url', 'thumbnailUrl'] as $key) {
                if (!empty($photo[$key])) {
                    $relative = parse_url((string)$photo[$key], PHP_URL_PATH);
                    $marker = '/uploads/';
                    $pos = strpos((string)$relative, $marker);
                    if ($pos !== false) {
                        $path = $uploadsDir . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, substr((string)$relative, $pos + strlen($marker)));
                        if (is_file($path)) @unlink($path);
                    }
                }
            }
        }
        $installation['photos'] = array_values(array_filter(
            $photos,
            function ($photo) use ($photoId) {
                return !is_array($photo) || (string)(array_get($photo, 'id', '')) !== $photoId;
            }
        ));
        $installation['updatedAt'] = gmdate('c');
        break;
    }
    unset($installation);
    if (!$target) throw new RuntimeException('Photo not found');
    $store['generatedAt'] = gmdate('c');
    write_data_file('installations.json', normalize_installations($store));
    $data = read_installations();
    return ['success' => true, 'installation' => installation_by_id($data, $installationId), 'data' => $data];
}

function update_assignment_workflow($dealId, $body, $action)
{
    $assignmentId = sanitize_segment((string)(array_get($body, 'assignmentId', '')));
    $actor = trim((string)(array_get($body, 'actor', '')));
    $dealNumber = trim((string)(array_get($body, 'dealNumber', '')));
    $dealTitle = trim((string)(array_get($body, 'dealTitle', '')));
    $employeeId = sanitize_segment((string)(array_get($body, 'employeeId', '')));
    $techSpecItemId = sanitize_segment((string)(array_get($body, 'techSpecItemId', '')));
    $completion = array_get($body, 'completion', null);
    if ($assignmentId === 'unknown') $assignmentId = '';
    if ($employeeId === 'unknown') $employeeId = '';
    if ($techSpecItemId === 'unknown') $techSpecItemId = '';
    $production = read_production();
    $updated = false;
    $targetIndex = null;

    foreach ($production['assignments'] as $index => $assignment) {
        if (!is_array($assignment)) continue;
        if ($assignmentId && (string)(array_get($assignment, 'id', '')) === $assignmentId) {
            $targetIndex = $index;
            break;
        }
    }

    if ($targetIndex === null) {
        foreach ($production['assignments'] as $index => $assignment) {
            if (!is_array($assignment)) continue;
            if ((string)(array_get($assignment, 'dealId', '')) !== $dealId) continue;
            if ($employeeId !== '' && (string)(array_get($assignment, 'employeeId', '')) !== $employeeId) continue;

            $assignmentTechSpecItemId = trim((string)(array_get($assignment, 'techSpecItemId', '')));
            if ($techSpecItemId !== '' && $assignmentTechSpecItemId !== $techSpecItemId) continue;
            if ($techSpecItemId === '' && $assignmentTechSpecItemId !== '') continue;

            $targetIndex = $index;
            break;
        }
    }

    if ($targetIndex !== null && isset($production['assignments'][$targetIndex]) && is_array($production['assignments'][$targetIndex])) {
        $assignment = &$production['assignments'][$targetIndex];
        if (!isset($assignment['history']) || !is_array($assignment['history'])) $assignment['history'] = [];
        if ($action === 'start') {
            $assignment['status'] = 'inProgress';
            $assignment['workerStatus'] = 'inWork';
            if (empty($assignment['startedAt'])) $assignment['startedAt'] = gmdate('c');
            $assignment['history'][] = [
                'id' => 'event_' . gmdate('Ymd_His') . '_' . random_hex(4),
                'type' => 'started',
                'at' => gmdate('c'),
                'actor' => $actor ?: 'Макетчик',
            ];
            $production['notifications'][] = notification_record('started', $dealId, $dealNumber, $dealTitle, $actor);
        } else {
            $assignment['status'] = 'submitted';
            $assignment['workerStatus'] = 'reviewPending';
            $assignment['submittedAt'] = gmdate('c');
            $assignment['completion'] = normalize_assignment_completion_payload($completion, $assignment);
            $assignment['history'][] = [
                'id' => 'event_' . gmdate('Ymd_His') . '_' . random_hex(4),
                'type' => 'submitted',
                'at' => gmdate('c'),
                'actor' => $actor ?: 'Макетчик',
            ];
            $production['notifications'][] = notification_record('completed', $dealId, $dealNumber, $dealTitle, $actor);
        }
        $updated = true;
    }
    unset($assignment);
    $production['generatedAt'] = gmdate('c');
    write_data_file('production.json', normalize_production($production));
    return ['success' => true, 'updated' => $updated, 'data' => $production];
}

function notification_record($type, $dealId, $dealNumber, $dealTitle, $actor)
{
    $number = $dealNumber ?: $dealId;
    $actorName = trim((string)$actor);
    $messages = [
        'started' => $actorName !== ''
            ? "Макетчик {$actorName} приступил к сборке сделки #{$number}"
            : "Макетчик приступил к сборке сделки #{$number}",
        'photosAdded' => "По сделке #{$number} добавлены фото",
        'completed' => "Сделка #{$number} завершена. Нужно проверить",
        'checked' => "Сделка #{$number} проверена",
        'needsRevision' => "Сделка #{$number} возвращена на доработку",
    ];
    return [
        'id' => 'notice_' . gmdate('Ymd_His') . '_' . random_hex(4),
        'type' => $type,
        'dealId' => $dealId,
        'dealNumber' => $dealNumber,
        'dealTitle' => $dealTitle,
        'message' => isset($messages[$type]) ? $messages[$type] : "Событие по сделке #{$number}",
        'actor' => $actor,
        'createdAt' => gmdate('c'),
        'readBy' => [],
    ];
}

function mark_notification_read($notificationId, $body)
{
    $employeeId = sanitize_segment((string)(array_get($body, 'employeeId', '')));
    $production = read_production();
    foreach ($production['notifications'] as &$notification) {
        if (!is_array($notification) || (string)(array_get($notification, 'id', '')) !== $notificationId) continue;
        if (!isset($notification['readBy']) || !is_array($notification['readBy'])) $notification['readBy'] = [];
        if ($employeeId && !in_array($employeeId, $notification['readBy'], true)) {
            $notification['readBy'][] = $employeeId;
        }
        $notification['readAt'] = gmdate('c');
    }
    unset($notification);
    $production['generatedAt'] = gmdate('c');
    write_data_file('production.json', $production);
    return ['success' => true, 'notifications' => $production['notifications']];
}

function mark_installation_notification_read($notificationId, $body)
{
    $employeeId = sanitize_segment((string)(array_get($body, 'employeeId', '')));
    $store = read_installations();
    foreach ($store['notifications'] as &$notification) {
        if (!is_array($notification) || (string)(array_get($notification, 'id', '')) !== $notificationId) continue;
        if (!isset($notification['readBy']) || !is_array($notification['readBy'])) $notification['readBy'] = [];
        if ($employeeId && !in_array($employeeId, $notification['readBy'], true)) {
            $notification['readBy'][] = $employeeId;
        }
        $notification['readAt'] = gmdate('c');
    }
    unset($notification);
    $store['generatedAt'] = gmdate('c');
    write_data_file('installations.json', normalize_installations($store));
    return ['success' => true, 'notifications' => $store['notifications']];
}
