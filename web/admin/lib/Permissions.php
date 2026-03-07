<?php

declare(strict_types=1);

final class Permissions
{
    public const ROLE_SUPER_ADMIN = 'SUPER_ADMIN';
    public const ROLE_INSTANCE_ADMIN = 'INSTANCE_ADMIN';
    public const ROLE_USER = 'USER';

    private const ROLE_PERMISSIONS = [
        self::ROLE_SUPER_ADMIN => ['*'],
        self::ROLE_INSTANCE_ADMIN => [
            'admin.access',
            'instance.manage',
            'instance.view',
            'files.read',
            'files.write',
            'files.delete',
            'users.manage',
        ],
        self::ROLE_USER => [],
    ];

    private const ALL_PERMISSIONS = [
        'admin.access',
        'instance.create',
        'instance.delete',
        'instance.manage',
        'instance.view',
        'files.read',
        'files.write',
        'files.delete',
        'users.create',
        'users.delete',
        'users.manage',
    ];

    public static function allPermissions(): array
    {
        return self::ALL_PERMISSIONS;
    }

    public static function allRoles(): array
    {
        return [
            self::ROLE_SUPER_ADMIN,
            self::ROLE_INSTANCE_ADMIN,
            self::ROLE_USER,
        ];
    }

    public static function rolePermissions(string $role): array
    {
        return self::ROLE_PERMISSIONS[$role] ?? [];
    }

    public static function isRoot(array $user): bool
    {
        return (($user['username'] ?? '') === 'root') && (($user['protected'] ?? false) === true);
    }

    public static function canAccessAdminPanel(array $user): bool
    {
        return self::hasPermission($user, 'admin.access');
    }

    public static function hasPermission(array $user, string $permission, ?string $instanceId = null): bool
    {
        if (self::isRoot($user) || ($user['role'] ?? '') === self::ROLE_SUPER_ADMIN) {
            return true;
        }

        $rules = self::effectivePermissions($user, $instanceId);
        foreach ($rules as $rule) {
            if (self::permissionMatch($permission, (string) $rule)) {
                return true;
            }
        }

        return false;
    }

    public static function canAccessInstance(array $user, array $instance): bool
    {
        if (self::isRoot($user) || ($user['role'] ?? '') === self::ROLE_SUPER_ADMIN) {
            return true;
        }

        $userId = (string) ($user['id'] ?? '');
        $instanceId = (string) ($instance['id'] ?? '');

        if ((string) ($instance['owner'] ?? '') === $userId) {
            return true;
        }

        $admins = is_array($instance['admins'] ?? null) ? $instance['admins'] : [];
        if (in_array($userId, $admins, true)) {
            return true;
        }

        $instances = is_array($user['instances'] ?? null) ? $user['instances'] : [];
        if (in_array($instanceId, $instances, true)) {
            return true;
        }

        return self::hasPermission($user, 'instance.manage', $instanceId)
            || self::hasPermission($user, 'instance.view', $instanceId)
            || self::hasPermission($user, 'files.read', $instanceId);
    }

    public static function assertPermissionOrThrow(array $user, string $permission, ?string $instanceId = null): void
    {
        if (!self::hasPermission($user, $permission, $instanceId)) {
            throw new RuntimeException('Insufficient permission: ' . $permission);
        }
    }

    public static function effectivePermissions(array $user, ?string $instanceId = null): array
    {
        if (self::isRoot($user) || ($user['role'] ?? '') === self::ROLE_SUPER_ADMIN) {
            return ['*'];
        }

        $role = (string) ($user['role'] ?? self::ROLE_USER);
        $permissions = self::rolePermissions($role);

        $customGlobal = is_array($user['permissions'] ?? null) ? $user['permissions'] : [];
        foreach ($customGlobal as $perm) {
            if (is_string($perm) && $perm !== '') {
                $permissions[] = $perm;
            }
        }

        if ($instanceId !== null) {
            $instancePermissions = is_array($user['instance_permissions'] ?? null) ? $user['instance_permissions'] : [];
            $instanceRules = $instancePermissions[$instanceId] ?? [];
            if (is_array($instanceRules)) {
                foreach ($instanceRules as $perm) {
                    if (is_string($perm) && $perm !== '') {
                        $permissions[] = $perm;
                    }
                }
            }
        }

        return array_values(array_unique($permissions));
    }

    private static function permissionMatch(string $required, string $rule): bool
    {
        if ($rule === '*' || $rule === $required) {
            return true;
        }

        if (substr($rule, -2) === '.*') {
            $prefix = substr($rule, 0, -1);
            return strpos($required, $prefix) === 0;
        }

        return false;
    }
}
