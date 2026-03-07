<?php

declare(strict_types=1);

final class Validator
{
    public static function requireString(array $source, string $key, int $min = 1, int $max = 255): string
    {
        $value = trim((string) ($source[$key] ?? ''));
        if ($value === '' || strlen($value) < $min || strlen($value) > $max) {
            throw new InvalidArgumentException("Invalid field: {$key}");
        }

        return $value;
    }

    public static function optionalString(array $source, string $key, int $max = 255): ?string
    {
        if (!isset($source[$key])) {
            return null;
        }

        $value = trim((string) $source[$key]);
        if (strlen($value) > $max) {
            throw new InvalidArgumentException("Invalid field length: {$key}");
        }

        return $value;
    }

    public static function username(string $value): string
    {
        if (!preg_match('/^[A-Za-z0-9_.-]{3,32}$/', $value)) {
            throw new InvalidArgumentException('Invalid username format');
        }

        return $value;
    }

    public static function email(string $value): string
    {
        if (!filter_var($value, FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException('Invalid email address');
        }

        return strtolower($value);
    }

    public static function role(string $value): string
    {
        if (!in_array($value, Permissions::allRoles(), true)) {
            throw new InvalidArgumentException('Invalid role');
        }

        return $value;
    }

    public static function instanceName(string $value): string
    {
        $value = trim($value);
        if (!preg_match('/^[A-Za-z0-9 _.-]{2,64}$/', $value)) {
            throw new InvalidArgumentException('Invalid instance name');
        }

        return $value;
    }

    public static function instanceId(array $source, string $key = 'instance_id'): string
    {
        $value = self::requireString($source, $key, 3, 120);
        if (!preg_match('/^[A-Za-z0-9_-]+$/', $value)) {
            throw new InvalidArgumentException('Invalid instance id');
        }

        return $value;
    }

    public static function userId(array $source, string $key = 'user_id'): string
    {
        $value = self::requireString($source, $key, 2, 120);
        if (!preg_match('/^[A-Za-z0-9_-]+$/', $value)) {
            throw new InvalidArgumentException('Invalid user id');
        }

        return $value;
    }

    public static function relativePath(?string $value): string
    {
        $value = trim((string) $value);
        if ($value === '' || $value === '/') {
            return '';
        }

        $value = str_replace('\\', '/', $value);
        $value = ltrim($value, '/');

        if (strpos($value, "\0") !== false) {
            throw new InvalidArgumentException('Invalid path');
        }

        $parts = explode('/', $value);
        foreach ($parts as $part) {
            if ($part === '' || $part === '.' || $part === '..') {
                throw new InvalidArgumentException('Invalid path traversal sequence');
            }
        }

        return implode('/', $parts);
    }

    public static function boolValue($value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        if (is_string($value)) {
            $normalized = strtolower(trim($value));
            if (in_array($normalized, ['1', 'true', 'yes', 'on'], true)) {
                return true;
            }
            if (in_array($normalized, ['0', 'false', 'no', 'off'], true)) {
                return false;
            }
        }

        return (bool) $value;
    }

    public static function permissionsArray($value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $perms = [];
        foreach ($value as $perm) {
            if (is_string($perm) && preg_match('/^[a-zA-Z0-9.*_-]+$/', $perm)) {
                $perms[] = $perm;
            }
        }

        return array_values(array_unique($perms));
    }
}
