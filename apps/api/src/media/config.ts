/**
 * Media storage configuration from the environment (PM-2). Errors name variables, never values.
 *
 *   DP_MEDIA_STORAGE=filesystem  DP_MEDIA_DIR=/data/media           (DEV, local, tests)
 *   DP_MEDIA_STORAGE=s3          DP_S3_ENDPOINT, DP_S3_REGION, DP_S3_BUCKET,
 *                                DP_S3_ACCESS_KEY_ID, DP_S3_SECRET_ACCESS_KEY,
 *                                DP_S3_FORCE_PATH_STYLE (default true)
 *   unset                        storage disabled: uploads and reads answer 503
 *
 * staging/production (DP_DEPLOY_ENV) must use s3. Secrets stay in the API process: the admin
 * app never receives them, and image bytes reach the browser only through the admin API.
 */
import { FilesystemStorage } from "./filesystem.js";
import { S3Storage } from "./s3.js";
import { DisabledStorage, type MediaStorage } from "./storage.js";

export class MediaConfigError extends Error {
  override name = "MediaConfigError";
}

export function createMediaStorage(env: Record<string, string | undefined>): MediaStorage {
  const kind = env["DP_MEDIA_STORAGE"]?.trim() || "";
  const deployEnv = env["DP_DEPLOY_ENV"]?.trim() || "local";
  const hosted = deployEnv === "staging" || deployEnv === "production";
  if (kind === "") {
    if (hosted) throw new MediaConfigError(`DP_MEDIA_STORAGE must be s3 in ${deployEnv}`);
    return new DisabledStorage();
  }
  if (kind === "filesystem") {
    if (hosted) throw new MediaConfigError(`DP_MEDIA_STORAGE must be s3 in ${deployEnv}`);
    const dir = env["DP_MEDIA_DIR"]?.trim();
    if (!dir) throw new MediaConfigError("DP_MEDIA_DIR is not set");
    return new FilesystemStorage(dir);
  }
  if (kind === "s3") {
    const need = (name: string) => {
      const v = env[name]?.trim();
      if (!v) throw new MediaConfigError(`${name} is not set`);
      return v;
    };
    const pathStyle = env["DP_S3_FORCE_PATH_STYLE"]?.trim() || "true";
    if (pathStyle !== "true" && pathStyle !== "false") {
      throw new MediaConfigError("DP_S3_FORCE_PATH_STYLE must be true or false");
    }
    const endpoint = need("DP_S3_ENDPOINT");
    try {
      new URL(endpoint);
    } catch {
      throw new MediaConfigError("DP_S3_ENDPOINT is not a URL");
    }
    return new S3Storage({
      endpoint,
      region: need("DP_S3_REGION"),
      bucket: need("DP_S3_BUCKET"),
      accessKeyId: need("DP_S3_ACCESS_KEY_ID"),
      secretAccessKey: need("DP_S3_SECRET_ACCESS_KEY"),
      forcePathStyle: pathStyle === "true",
    });
  }
  throw new MediaConfigError("DP_MEDIA_STORAGE must be filesystem or s3");
}
