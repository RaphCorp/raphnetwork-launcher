<?php

declare(strict_types=1);

final class FileManager
{
    public static function instanceBasePath(array $instance): string
    {
        $path = (string) ($instance['filesystem_path'] ?? '');
        if ($path === '') {
            throw new RuntimeException('Instance path is missing');
        }

        $path = str_replace('\\', '/', $path);
        $real = realpath($path);
        if ($real === false || !is_dir($real)) {
            throw new RuntimeException('Instance directory does not exist');
        }

        $root = str_replace('\\', '/', DataStore::getInstancesRoot());
        $real = str_replace('\\', '/', $real);

        if (!self::isWithin($real, $root)) {
            throw new RuntimeException('Instance path outside allowed root');
        }

        return $real;
    }

    public static function listDirectory(string $basePath, string $relativePath = ''): array
    {
        $target = self::resolvePath($basePath, $relativePath, false, true);
        if (!is_dir($target)) {
            throw new RuntimeException('Directory not found');
        }

        $items = [];
        $entries = scandir($target);
        if (!is_array($entries)) {
            return [];
        }

        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }

            $fullPath = $target . DIRECTORY_SEPARATOR . $entry;
            $isDir = is_dir($fullPath);

            $items[] = [
                'name' => $entry,
                'path' => trim($relativePath . '/' . $entry, '/'),
                'type' => $isDir ? 'directory' : 'file',
                'size' => $isDir ? null : filesize($fullPath),
                'modified_at' => gmdate('c', filemtime($fullPath) ?: time()),
            ];
        }

        usort($items, static function (array $a, array $b): int {
            if ($a['type'] !== $b['type']) {
                return $a['type'] === 'directory' ? -1 : 1;
            }

            return strcmp((string) $a['name'], (string) $b['name']);
        });

        return $items;
    }

    public static function readFileContent(string $basePath, string $relativePath): string
    {
        $target = self::resolvePath($basePath, $relativePath, false, false);

        if (!is_file($target)) {
            throw new RuntimeException('File not found');
        }

        $size = filesize($target);
        if ($size !== false && $size > 5 * 1024 * 1024) {
            throw new RuntimeException('File too large to edit in browser');
        }

        $content = file_get_contents($target);
        if ($content === false) {
            throw new RuntimeException('Unable to read file');
        }

        return $content;
    }

    public static function writeFileContent(string $basePath, string $relativePath, string $content): void
    {
        $target = self::resolvePath($basePath, $relativePath, true, false);

        $directory = dirname($target);
        if (!is_dir($directory)) {
            throw new RuntimeException('Parent directory does not exist');
        }

        self::assertWritable($directory, 'Directory');

        if (file_put_contents($target, $content, LOCK_EX) === false) {
            throw new RuntimeException('Unable to write file');
        }
    }

    public static function uploadFile(string $basePath, string $relativeDirectory, array $uploadedFile): void
    {
        if (($uploadedFile['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            throw new RuntimeException('Upload failed');
        }

        $fileName = (string) ($uploadedFile['name'] ?? '');
        if ($fileName === '' || strpbrk($fileName, "/\\") !== false || strpos($fileName, "\0") !== false) {
            throw new RuntimeException('Invalid upload filename');
        }

        $safeRelative = Validator::relativePath(trim($relativeDirectory . '/' . $fileName, '/'));
        $target = self::resolvePath($basePath, $safeRelative, true, false);

        $tmpPath = (string) ($uploadedFile['tmp_name'] ?? '');
        if ($tmpPath === '' || !is_uploaded_file($tmpPath)) {
            throw new RuntimeException('Invalid upload source');
        }

        $parent = dirname($target);
        if (!is_dir($parent)) {
            throw new RuntimeException('Upload directory does not exist');
        }

        self::assertWritable($parent, 'Upload directory');

        if (!move_uploaded_file($tmpPath, $target)) {
            $lastError = error_get_last();
            $detail = is_array($lastError) && isset($lastError['message']) ? (' (' . $lastError['message'] . ')') : '';
            throw new RuntimeException('Unable to store uploaded file. Check filesystem permissions for: ' . $parent . $detail);
        }
    }

    public static function createFolder(string $basePath, string $relativePath): void
    {
        $target = self::resolvePath($basePath, $relativePath, true, false);
        if (is_dir($target)) {
            return;
        }

        $parent = dirname($target);
        if (!is_dir($parent)) {
            throw new RuntimeException('Parent directory does not exist: ' . $parent);
        }

        self::assertWritable($parent, 'Parent directory');

        if (!mkdir($target, 0750, true) && !is_dir($target)) {
            throw new RuntimeException('Unable to create directory');
        }
    }

    public static function deletePath(string $basePath, string $relativePath): void
    {
        $relativePath = Validator::relativePath($relativePath);
        if ($relativePath === '') {
            throw new RuntimeException('Cannot delete instance root directory');
        }

        $target = self::resolvePath($basePath, $relativePath, false, false);
        if (!file_exists($target)) {
            throw new RuntimeException('Path does not exist');
        }

        if (is_dir($target)) {
            self::deleteDirectoryRecursively($target);
            return;
        }

        if (!is_writable($target)) {
            self::assertWritable(dirname($target), 'Parent directory');
        }

        if (!unlink($target)) {
            throw new RuntimeException('Unable to delete file');
        }
    }

    public static function deleteDirectoryRecursively(string $directory): void
    {
        $entries = scandir($directory);
        if (!is_array($entries)) {
            throw new RuntimeException('Unable to read directory for deletion');
        }

        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }

            $path = $directory . DIRECTORY_SEPARATOR . $entry;
            if (is_dir($path)) {
                self::deleteDirectoryRecursively($path);
                continue;
            }

            if (!unlink($path)) {
                throw new RuntimeException('Unable to delete file inside directory');
            }
        }

        if (!rmdir($directory)) {
            throw new RuntimeException('Unable to delete directory');
        }
    }

    private static function assertWritable(string $path, string $label): void
    {
        if (is_writable($path)) {
            return;
        }

        @chmod($path, 0775);
        clearstatcache(true, $path);

        if (!is_writable($path)) {
            throw new RuntimeException($label . ' is not writable by PHP: ' . $path . '. Adjust owner/group permissions.');
        }
    }

    private static function resolvePath(string $basePath, string $relativePath, bool $allowMissingTarget, bool $expectDirectory): string
    {
        $relativePath = Validator::relativePath($relativePath);

        if ($relativePath === '') {
            return $basePath;
        }

        $candidate = $basePath . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);

        if (!$allowMissingTarget || file_exists($candidate)) {
            $real = realpath($candidate);
            if ($real === false) {
                throw new RuntimeException('Path not found');
            }

            $real = str_replace('\\', '/', $real);
            if (!self::isWithin($real, $basePath)) {
                throw new RuntimeException('Path traversal blocked');
            }

            if ($expectDirectory && !is_dir($real)) {
                throw new RuntimeException('Expected directory');
            }

            return $real;
        }

        $parent = dirname($candidate);
        $parentReal = realpath($parent);
        if ($parentReal === false) {
            throw new RuntimeException('Parent directory not found');
        }

        $parentReal = str_replace('\\', '/', $parentReal);
        if (!self::isWithin($parentReal, $basePath)) {
            throw new RuntimeException('Path traversal blocked');
        }

        $filename = basename($candidate);
        if ($filename === '' || $filename === '.' || $filename === '..') {
            throw new RuntimeException('Invalid path');
        }

        return $parentReal . '/' . $filename;
    }

    private static function isWithin(string $target, string $root): bool
    {
        $target = rtrim(str_replace('\\', '/', $target), '/');
        $root = rtrim(str_replace('\\', '/', $root), '/');

        if ($target === $root) {
            return true;
        }

        return strpos($target . '/', $root . '/') === 0;
    }
}
