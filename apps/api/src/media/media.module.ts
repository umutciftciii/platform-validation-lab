import { Module } from "@nestjs/common";
import { createMediaStorage } from "./config.js";
import { ImageProcessingGate, imageGateFromEnv } from "./image-gate.js";

/** Injection token of the configured MediaStorage (PM-2). */
export const MEDIA_STORAGE = Symbol("MEDIA_STORAGE");

// Created once at start-up: a misconfigured storage stops the API (variables named, values not).
// PM-3: one image processing gate per process (memory bound of image decoding).
@Module({
  providers: [
    { provide: MEDIA_STORAGE, useFactory: () => createMediaStorage(process.env) },
    { provide: ImageProcessingGate, useFactory: () => imageGateFromEnv(process.env) },
  ],
  exports: [MEDIA_STORAGE, ImageProcessingGate],
})
export class MediaModule {}
