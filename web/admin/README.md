# Admin Module

This folder contains a secure administration panel exposed under `/admin`.

## Initial Root Account

- Username: `root`
- Role: `SUPER_ADMIN`
- Protected: cannot be modified/deleted/demoted via API.

Set `ADMIN_ROOT_PASSWORD` in your web server environment before first startup.
If not set, a strong password is generated once and stored in:

- `<ADMIN_DATA_DIR>/root_credentials.txt` (or auto-selected writable fallback directory)

## API Modules

- `/admin/api/auth.php`
- `/admin/api/overview.php`
- `/admin/api/users.php`
- `/admin/api/instances.php`
- `/admin/api/files.php`
- `/admin/api/permissions.php`
- `/admin/api/settings.php`

All mutating endpoints require a valid session + CSRF token.


If your host web root is read-only, define ADMIN_DATA_DIR to a writable location (for example /home/container/data/raph_admin).

