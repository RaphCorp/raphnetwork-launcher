<?php

declare(strict_types=1);

final class Permissions
{
    public const ROLE_SUPER_ADMIN = 'SUPER_ADMIN';
    public const ROLE_INSTANCE_ADMIN = 'INSTANCE_ADMIN';
    public const ROLE_USER = 'USER';

    private const BUILTIN_ROLE_PERMISSIONS = [
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

    public static function builtinRoles(): array
    {
        return [
            self::ROLE_SUPER_ADMIN,
            self::ROLE_INSTANCE_ADMIN,
            self::ROLE_USER,
        ];
    }

    public static function allRoles(): array
    {
        $map = self::rolePermissionsMap();
        $roles = [];

        foreach (self::builtinRoles() as $builtinRole) {
            if (isset($map[$builtinRole])) {
                $roles[] = $builtinRole;
                unset($map[$builtinRole]);
            }
        }

        $customRoles = array_keys($map);
        sort($customRoles, SORT_STRING);

        return array_merge($roles, $customRoles);
    }

    public static function rolePermissions(string $role): array
    {
        $map = self::rolePermissionsMap();
        return $map[$role] ?? [];
    }

    public static function roleMetadata(): array
    {
        $metadata = [];
        foreach (self::allRoles() as $role) {
            $builtin = self::isBuiltinRole($role);

            $metadata[$role] = [
                'permissions' => self::rolePermissions($role),
                'builtin' => $builtin,
                'editable' => $role !== self::ROLE_SUPER_ADMIN,
                'deletable' => !$builtin,
            ];
        }

        return $metadata;
    }

    public static function isBuiltinRole(string $role): bool
    {
        return in_array($role, self::builtinRoles(), true);
    }

    public static function roleExists(string $role): bool
    {
        return in_array($role, self::allRoles(), true);
    }

    public static function isRoot(array $user): bool
    {
        return (($user['username'] ?? '') === 'root') && (($user['protected'] ?? false) === true);
    }

    public static function canAccessAdminPanel(array $user): bool
    {
        return self::hasPermission($user, 'admin.access') || self::hasScopedAdminAccess($user);
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

    private static function hasScopedAdminAccess(array $user): bool
    {
        $instancePermissionMap = is_array($user['instance_permissions'] ?? null) ? $user['instance_permissions'] : [];
        if ($instancePermissionMap === []) {
            return false;
        }

        foreach ($instancePermissionMap as $instanceRules) {
            if (!is_array($instanceRules)) {
                continue;
            }

            foreach ($instanceRules as $rule) {
                if (!is_string($rule) || $rule === '') {
                    continue;
                }

                if (
                    self::permissionMatch('instance.view', $rule)
                    || self::permissionMatch('instance.manage', $rule)
                    || self::permissionMatch('instance.delete', $rule)
                    || self::permissionMatch('files.read', $rule)
                    || self::permissionMatch('files.write', $rule)
                    || self::permissionMatch('files.delete', $rule)
                ) {
                    return true;
                }
            }
        }

        return false;
    }

    private static function rolePermissionsMap(): array
    {
        $map = self::BUILTIN_ROLE_PERMISSIONS;
        $customRoles = self::customRolesFromSettings();

        foreach ($customRoles as $role => $permissions) {
            if ($role === self::ROLE_SUPER_ADMIN) {
                continue;
            }
            $map[$role] = $permissions;
        }

        // Super admin must always retain full access.
        $map[self::ROLE_SUPER_ADMIN] = ['*'];

        return $map;
    }

    private static function customRolesFromSettings(): array
    {
        if (!class_exists('DataStore')) {
            return [];
        }

        $settings = DataStore::loadSettings();
        $raw = $settings['custom_roles'] ?? [];
        if (!is_array($raw)) {
            return [];
        }

        $roles = [];
        foreach ($raw as $role => $permissions) {
            if (!is_string($role) || !preg_match('/^[A-Z][A-Z0-9_]{2,63}$/', $role)) {
                continue;
            }

            if (!is_array($permissions)) {
                continue;
            }

            $sanitized = [];
            foreach ($permissions as $permission) {
                if (is_string($permission) && preg_match('/^[a-zA-Z0-9.*_-]+$/', $permission)) {
                    $sanitized[] = $permission;
                }
            }

            $roles[$role] = array_values(array_unique($sanitized));
        }

        return $roles;
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
