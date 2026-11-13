import { createApiApp } from "./app.factory.js";

async function bootstrap() {
  const app = await createApiApp();
  app.enableShutdownHooks();
  const port = Number(process.env["PORT"] ?? 3113);
  await app.listen(port, "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  // Configuration errors name the variable, never its value (ADR-013 D19).
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : "start-up failed");
  process.exit(1);
});
