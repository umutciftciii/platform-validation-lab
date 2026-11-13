// Host ports reserved for this platform (see infra/docker/compose.yaml).
export const PORTS = {
  "web-bv": 3110,
  "web-corporate": 3111,
  admin: 3112,
  api: 3113,
  // DP-119: DEV only, HTTPS proxy in front of the admin console (Caddy, local CA).
  "admin-tls": 3114,
  postgres: 5440,
};
