<?php

declare(strict_types=1);

require_once __DIR__ . '/../bootstrap.php';
admin_security_headers();

$method = admin_require_method(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
$currentUser = admin_require_auth();
$body = admin_parse_body();

$instanceId = (string) ($_GET['instance_id'] ?? ($body['instance_id'] ?? ''));
if ($instanceId === '') {
    admin_json_response(['success' => false, 'error' => 'instance_id is required'], 422);
}

$instances = DataStore::loadInstances();
$instance = DataStore::findInstanceById($instances, $instanceId);
if ($instance === null) {
    admin_json_response(['success' => false, 'error' => 'Instance not found'], 404);
}

if (!Permissions::canAccessInstance($currentUser, $instance)) {
    admin_json_response(['success' => false, 'error' => 'Forbidden'], 403);
}

try {
    $basePath = FileManager::instanceBasePath($instance);
} catch (RuntimeException $exception) {
    admin_json_response(['success' => false, 'error' => $exception->getMessage()], 500);
}

$defaultAction = $method === 'GET' ? 'list' : ($method === 'DELETE' ? 'delete' : 'write');
$action = strtolower((string) ($_GET['action'] ?? ($body['action'] ?? $defaultAction)));

if ($action === 'list') {
    admin_require_permission($currentUser, 'files.read', $instanceId);

    try {
        $path = Validator::relativePath((string) ($_GET['path'] ?? ($body['path'] ?? '')));
        $items = FileManager::listDirectory($basePath, $path);
    } catch (InvalidArgumentException | RuntimeException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
    }

    admin_json_response([
        'success' => true,
        'cwd' => $path,
        'items' => $items,
    ]);
}

if ($action === 'read') {
    admin_require_permission($currentUser, 'files.read', $instanceId);

    try {
        $path = Validator::relativePath((string) ($_GET['path'] ?? ($body['path'] ?? '')));
        $content = FileManager::readFileContent($basePath, $path);
    } catch (InvalidArgumentException | RuntimeException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
    }

    admin_json_response([
        'success' => true,
        'path' => $path,
        'content' => $content,
    ]);
}

if ($action === 'write') {
    admin_require_permission($currentUser, 'files.write', $instanceId);
    admin_require_csrf_for_mutation($method);

    try {
        $path = Validator::relativePath((string) ($body['path'] ?? ''));
        $content = (string) ($body['content'] ?? '');
        if ($path === '') {
            throw new InvalidArgumentException('File path is required');
        }

        FileManager::writeFileContent($basePath, $path, $content);
    } catch (InvalidArgumentException | RuntimeException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
    }

    admin_json_response(['success' => true, 'path' => $path]);
}

if ($action === 'upload') {
    admin_require_permission($currentUser, 'files.write', $instanceId);
    admin_require_csrf_for_mutation($method);

    $relativeDirectory = (string) ($body['path'] ?? ($_POST['path'] ?? ''));
    $upload = $_FILES['file'] ?? null;

    if (!is_array($upload)) {
        admin_json_response(['success' => false, 'error' => 'No upload file provided'], 422);
    }

    try {
        $relativeDirectory = Validator::relativePath($relativeDirectory);
        FileManager::uploadFile($basePath, $relativeDirectory, $upload);
    } catch (InvalidArgumentException | RuntimeException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
    }

    admin_json_response(['success' => true]);
}

if ($action === 'mkdir') {
    admin_require_permission($currentUser, 'files.write', $instanceId);
    admin_require_csrf_for_mutation($method);

    try {
        $path = Validator::relativePath((string) ($body['path'] ?? ''));
        if ($path === '') {
            throw new InvalidArgumentException('Folder path is required');
        }
        FileManager::createFolder($basePath, $path);
    } catch (InvalidArgumentException | RuntimeException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
    }

    admin_json_response(['success' => true, 'path' => $path]);
}

if ($action === 'delete') {
    admin_require_permission($currentUser, 'files.delete', $instanceId);
    admin_require_csrf_for_mutation($method);

    try {
        $path = Validator::relativePath((string) ($body['path'] ?? ($_GET['path'] ?? '')));
        if ($path === '') {
            throw new InvalidArgumentException('Target path is required');
        }

        FileManager::deletePath($basePath, $path);
    } catch (InvalidArgumentException | RuntimeException $exception) {
        admin_json_response(['success' => false, 'error' => $exception->getMessage()], 422);
    }

    admin_json_response(['success' => true]);
}

admin_json_response(['success' => false, 'error' => 'Unknown action'], 400);
