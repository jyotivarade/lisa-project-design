"""Permission catalogue and the role → permission matrix.

Permissions are data (rows in `permissions` / `role_permissions`), not hard-coded
checks, so an administrator can re-scope a role without a deployment. This module is
the seed source and the constant reference used by `require_permission(...)`.
"""

from app.models.enums import RoleName


class Perm:
    ANALYTICS_READ = "analytics:read"
    ANALYTICS_WRITE = "analytics:write"
    CONFIGURATION_READ = "configuration:read"
    CONFIGURATION_WRITE = "configuration:write"
    FILES_READ = "files:read"
    FILES_UPLOAD = "files:upload"
    FILES_DOWNLOAD = "files:download"
    PROCESSING_READ = "processing:read"
    PROCESSING_VALIDATE = "processing:validate"
    PROCESSING_EXECUTE = "processing:execute"
    PROCESSING_RERUN = "processing:rerun"
    CORRECTIONS_WRITE = "corrections:write"
    RESULTS_READ = "results:read"
    AUDIT_READ = "audit:read"
    USERS_READ = "users:read"
    USERS_WRITE = "users:write"
    ROLES_WRITE = "roles:write"


PERMISSION_DESCRIPTIONS: dict[str, str] = {
    Perm.ANALYTICS_READ: "View analytics and their summaries",
    Perm.ANALYTICS_WRITE: "Create and edit analytics",
    Perm.CONFIGURATION_READ: "View analytics configuration and version history",
    Perm.CONFIGURATION_WRITE: "Create a new configuration version",
    Perm.FILES_READ: "View uploaded files and previews",
    Perm.FILES_UPLOAD: "Upload CSV files",
    Perm.FILES_DOWNLOAD: "Download original and generated files",
    Perm.PROCESSING_READ: "View processing sessions, rows and gate state",
    Perm.PROCESSING_VALIDATE: "Select calibrators/controls and run validation",
    Perm.PROCESSING_EXECUTE: "Start patient processing",
    Perm.PROCESSING_RERUN: "Rerun a previously uploaded file as a new session",
    Perm.CORRECTIONS_WRITE: "Record corrections to calibrator/control values",
    Perm.RESULTS_READ: "View patient results and exception reports",
    Perm.AUDIT_READ: "View the audit trail",
    Perm.USERS_READ: "View users",
    Perm.USERS_WRITE: "Create and edit users",
    Perm.ROLES_WRITE: "Change role permissions",
}

ALL_PERMISSIONS: list[str] = list(PERMISSION_DESCRIPTIONS)

_READ_ONLY = [
    Perm.ANALYTICS_READ,
    Perm.CONFIGURATION_READ,
    Perm.FILES_READ,
    Perm.FILES_DOWNLOAD,
    Perm.PROCESSING_READ,
    Perm.RESULTS_READ,
]

ROLE_PERMISSIONS: dict[str, list[str]] = {
    RoleName.ADMIN.value: ALL_PERMISSIONS,
    # An analyst runs the laboratory workflow end to end but cannot administer
    # users, roles, or read the audit trail — separation of duty (§37).
    RoleName.ANALYST.value: [
        Perm.ANALYTICS_READ,
        Perm.ANALYTICS_WRITE,
        Perm.CONFIGURATION_READ,
        Perm.CONFIGURATION_WRITE,
        Perm.FILES_READ,
        Perm.FILES_UPLOAD,
        Perm.FILES_DOWNLOAD,
        Perm.PROCESSING_READ,
        Perm.PROCESSING_VALIDATE,
        Perm.PROCESSING_EXECUTE,
        Perm.PROCESSING_RERUN,
        Perm.CORRECTIONS_WRITE,
        Perm.RESULTS_READ,
    ],
    RoleName.VIEWER.value: _READ_ONLY,
}

ROLE_DESCRIPTIONS: dict[str, str] = {
    RoleName.ADMIN.value: "Full access, including users, roles and the audit trail",
    RoleName.ANALYST.value: "Runs the laboratory workflow: upload, validate, process, review",
    RoleName.VIEWER.value: "Read-only access to analytics, files and results",
}
