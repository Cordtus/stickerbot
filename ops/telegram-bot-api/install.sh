#!/usr/bin/env bash
set -euo pipefail

readonly service_user="telegram-bot-api"
readonly module_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly install_root="${INSTALL_ROOT:-/}"

if [[ "${install_root}" == "/" ]]; then
    if [[ "$(id -u)" -ne 0 ]]; then
        printf '%s\n' 'install.sh must run as root (or use INSTALL_ROOT for staging).' >&2
        exit 1
    fi
    readonly staging=false
else
    readonly staging=true
fi

destination() {
    printf '%s%s' "${install_root%/}" "$1"
}

if [[ "${staging}" == false ]]; then
    if ! getent group "${service_user}" >/dev/null; then
        groupadd --system "${service_user}"
    fi
    if ! id -u "${service_user}" >/dev/null 2>&1; then
        useradd --system --gid "${service_user}" --home-dir /var/lib/telegram-bot-api --shell /usr/sbin/nologin --no-create-home "${service_user}"
    fi
fi

readonly config_dir="$(destination /etc/telegram-bot-api)"
readonly state_dir="$(destination /var/lib/telegram-bot-api/state)"
readonly temp_dir="$(destination /var/lib/telegram-bot-api/tmp)"
readonly log_dir="$(destination /var/log/telegram-bot-api)"
readonly bin_dir="$(destination /usr/local/libexec/telegram-bot-api)"
readonly unit_dir="$(destination /etc/systemd/system)"

install -d -m 0700 "${config_dir}" "${state_dir}" "${temp_dir}"
install -d -m 0750 "${log_dir}" "${bin_dir}"
install -d -m 0755 "${unit_dir}"

if [[ "${staging}" == false ]]; then
    chown root:root "${config_dir}"
    chown "root:${service_user}" "${bin_dir}"
    chown -R "${service_user}:${service_user}" "${state_dir}" "${temp_dir}" "${log_dir}"
fi

(
    cd "${module_root}"
    go build -trimpath -o "${bin_dir}/file-gateway" ./cmd/file-gateway
    go build -trimpath -o "${bin_dir}/cache-cleaner" ./cmd/cache-cleaner
)
chmod 0750 "${bin_dir}/file-gateway" "${bin_dir}/cache-cleaner"
if [[ "${staging}" == false ]]; then
    chown "root:${service_user}" "${bin_dir}/file-gateway" "${bin_dir}/cache-cleaner"
fi

for unit in telegram-bot-api.service telegram-bot-api-file-gateway.service telegram-bot-api-cache-cleaner.service telegram-bot-api-cache-cleaner.timer; do
    install -m 0644 "${module_root}/systemd/${unit}" "${unit_dir}/${unit}"
done

# Credentials are deliberately operator-managed. This installer never creates,
# modifies, or reads /etc/telegram-bot-api/telegram-bot-api.env.
if [[ "${staging}" == false ]]; then
    systemctl daemon-reload
fi
