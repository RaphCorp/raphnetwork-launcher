<?php

declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';
admin_security_headers();

admin_require_method(['GET']);
$user = admin_require_auth();
admin_require_permission($user, 'admin.access');

$users = DataStore::loadUsers();
$instances = DataStore::loadInstances();
$settings = DataStore::loadSettings();

$visibleInstances = [];
foreach ($instances as $instance) {
    if (Permissions::canAccessInstance($user, $instance)) {
        $visibleInstances[] = $instance;
    }
}

$adminUsers = 0;
foreach ($users as $candidate) {
    if (in_array(($candidate['role'] ?? ''), [Permissions::ROLE_SUPER_ADMIN, Permissions::ROLE_INSTANCE_ADMIN], true)) {
        $adminUsers++;
    }
}

$diskRoot = DataStore::getInstancesRoot();
$diskTotal = @disk_total_space($diskRoot);
$diskFree = @disk_free_space($diskRoot);

$statusSummary = [
    'online' => 0,
    'offline' => 0,
    'maintenance' => 0,
    'unknown' => 0,
];

foreach ($visibleInstances as $instance) {
    $status = strtolower((string) ($instance['status'] ?? 'unknown'));
    if (!isset($statusSummary[$status])) {
        $status = 'unknown';
    }
    $statusSummary[$status]++;
}

admin_json_response([
    'success' => true,
    'overview' => [
        'instances_total' => count($instances),
        'instances_visible' => count($visibleInstances),
        'users_total' => count($users),
        'admins_total' => $adminUsers,
        'status_summary' => $statusSummary,
        'disk' => [
            'root' => $diskRoot,
            'total_bytes' => is_numeric($diskTotal) ? (int) $diskTotal : null,
            'free_bytes' => is_numeric($diskFree) ? (int) $diskFree : null,
        ],
        'system_settings' => $settings,
    ],
]);
