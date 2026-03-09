<?php
header("Content-Type: application/json; charset=UTF-8");
include 'php/scandir.php';

$helperFile = __DIR__ . '/php/instance_config.php';
if (is_file($helperFile)) {
    require_once $helperFile;
}

$instance_param = (string) ($_GET['instance'] ?? 'null');

if ($instance_param === '/' || ($instance_param !== '' && $instance_param[0] === '.') || strpos($instance_param, '..') !== false || strpos($instance_param, "\0") !== false) {
    echo json_encode([]);
    exit;
}

if (!file_exists(__DIR__ . '/instances')) {
    echo dirToArray("files");
    exit;
}

if ($instance_param === 'null') {
    $requestUri = (string) ($_SERVER['REQUEST_URI'] ?? '/instances');
    if (substr($requestUri, -1) === '/') {
        $requestUri = substr($requestUri, 0, -1);
    }

    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (string) ($_SERVER['SERVER_PORT'] ?? '') === '443';
    $scheme = $isHttps ? 'https' : 'http';
    $host = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');

    if (function_exists('raph_launcher_build_payload_map') && function_exists('raph_launcher_scan_instance_names')) {
        try {
            $instances_list = raph_launcher_scan_instance_names();
            $instance = raph_launcher_build_payload_map($instances_list, static function (string $instanceName) use ($scheme, $host, $requestUri): string {
                return $scheme . '://' . $host . $requestUri . '?instance=' . rawurlencode($instanceName);
            });

            echo json_encode($instance, JSON_UNESCAPED_SLASHES);
            exit;
        } catch (Throwable $exception) {
            // Fallback to legacy mode below.
        }
    }

    $instances_list = scanFolder("instances");
    $instance = array();
    foreach ($instances_list as $value) {
        $url = $scheme . '://' . $host . $requestUri . '?instance=' . rawurlencode($value);
        $instance[$value] = array("name" => $value, "url" => $url);
    }

    if (is_file(__DIR__ . '/php/instances.php')) {
        include 'php/instances.php';
    }

    echo str_replace("\\", "", json_encode($instance));
    exit;
}

echo dirToArray("instances/$instance_param");
?>
