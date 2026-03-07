<?php

declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';
admin_security_headers();

$method = admin_require_method(['GET', 'PUT', 'PATCH']);
$currentUser = admin_require_auth();
admin_require_permission($currentUser, 'admin.access');

if ($method === 'GET') {
    admin_json_response([
        'success' => true,
        'settings' => DataStore::loadSettings(),
    ]);
}

if (!Permissions::isRoot($currentUser) && ($currentUser['role'] ?? '') !== Permissions::ROLE_SUPER_ADMIN) {
    admin_json_response(['success' => false, 'error' => 'Only SUPER_ADMIN can modify system settings'], 403);
}

admin_require_csrf_for_mutation($method);
$body = admin_parse_body();
$settings = DataStore::loadSettings();

try {
    if (array_key_exists('site_name', $body)) {
        $settings['site_name'] = Validator::requireString($body, 'site_name', 2, 120);
    }

    if (array_key_exists('maintenance_mode', $body)) {
        $settings['maintenance_mode'] = Validator::boolValue($body['maintenance_mode']);
    }

    if (array_key_exists('session_timeout_minutes', $body)) {
        $timeout = (int) $body['session_timeout_minutes'];
        if ($timeout < 10 || $timeout > 1440) {
            throw new InvalidArgumentException('session_timeout_minutes must be between 10 and 1440');
        }
        $settings['session_timeout_minutes'] = $timeout;
    }

    if (array_key_exists('allow_instance_delete', $body)) {
        $settings['allow_instance_delete'] = Validator::boolValue($body['allow_instance_delete']);
    }
} catch (InvalidArgumentException $exception) {
    admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
}

$settings['updated_at'] = DataStore::nowIso();
DataStore::saveSettings($settings);

admin_json_response([
    'success' => true,
    'settings' => $settings,
]);
