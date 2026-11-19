import { Module } from "@nestjs/common";
import { IamModule } from "../iam/iam.module.js";
import { API_CONFIG, type ApiConfig } from "../iam/http/api-config.js";
import { MAIL_SENDER, createMailSender, loadMailConfig } from "./mail.js";

export const MAIL_CONFIG = "DP_MAIL_CONFIG";

// DP-221 (ADR-026 D5): outgoing e-mail. The configuration is validated at start-up (smtp is
// refused while DP_DEPLOY_ENV=local); one sender per process.
@Module({
  imports: [IamModule],
  providers: [
    {
      provide: MAIL_CONFIG,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => loadMailConfig(process.env, config.deployEnv),
    },
    {
      provide: MAIL_SENDER,
      inject: [MAIL_CONFIG],
      useFactory: createMailSender,
    },
  ],
  exports: [MAIL_CONFIG, MAIL_SENDER],
})
export class NotificationsModule {}
