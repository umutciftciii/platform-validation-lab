/**
 * English messages of the admin console: the source language and the source of the message key
 * type (lib/i18n/types.ts). Every string here was moved verbatim from the component that used it,
 * so the English console renders exactly as before ML-11. `{name}` is a parameter; an object with
 * `one` and `other` is a plural chosen by `count` (Intl.PluralRules).
 *
 * ML-11 covers the shell, navigation, sign-in, enrolment, password reset, session errors, 404 and
 * the error boundary. The modules' own screens follow per area in ML-12a–e (DP-243).
 */
export const en = {
  common: {
    tryAgain: "Try again",
    loading: "Loading",
    backToOverview: "Back to overview",
    sampleData: "Sample data",
    sampleDataTitle: "Sample data for the design prototype. Not connected to any system.",
  },
  language: {
    label: "Language",
    english: "English",
    turkish: "Türkçe",
    switching: "Changing the language…",
  },
  theme: {
    label: "Colour theme",
    light: "Light",
    dark: "Dark",
    system: "Match system",
  },
  shell: {
    skipToContent: "Skip to content",
    navigation: "Navigation",
    openNavigation: "Open navigation",
    closeNavigation: "Close navigation",
    breadcrumb: "Breadcrumb",
    admin: "Admin",
    theme: "Theme",
    homeLink: "Dream Petroleum admin console, overview",
    adminConsole: "Admin console",
    mainNavigation: "Main",
    soon: "Soon",
    environment: "Environment: {name}",
    environments: {
      local: "Local development",
      staging: "Staging",
      production: "Production",
    },
  },
  nav: {
    groups: {
      workspace: "Workspace",
      administration: "Administration",
      owner: "Owner",
    },
    items: {
      overview: { label: "Overview", summary: "Activity and status across both sites." },
      content: { label: "Content", summary: "Write, review and publish pages for both sites." },
      products: {
        label: "Products",
        summary: "Keep product data sheets and specifications current.",
      },
      seo: { label: "SEO", summary: "Search results and link previews of the BV site." },
      companyReview: {
        label: "Company review",
        summary: "Proposed product texts for the company's approval.",
      },
      leads: {
        label: "Leads",
        summary:
          "Contact-form messages and document requests from the public sites (customer data, audited).",
      },
      sites: { label: "Sites", summary: "Domains, navigation and publishing for each site." },
      staff: {
        label: "Staff and access",
        summary: "Invite staff and give or remove roles, lead access included.",
      },
      audit: {
        label: "Audit log",
        summary: "Every sign-in, permission change and publication, in order.",
      },
      settings: { label: "Settings", summary: "Your profile, sessions and authenticator." },
      owner: {
        label: "Owner console",
        summary: "Module switches and the protected audit trail (system owner only).",
      },
    },
  },
  userMenu: {
    openMenu: "Account menu",
    menu: "Account",
    accountSettings: "Account settings",
    signingOut: "Signing out…",
    signOut: "Sign out",
  },
  section: {
    notFound: "Not found",
    notAvailable: "{label} is not available yet",
    planned:
      "This module is planned for a later release of the admin console. Nothing here can be changed yet.",
  },
  notFound: {
    title: "Page not found",
    text: "This address does not exist in the admin console. Check the link or go back to the overview.",
  },
  errorPage: {
    title: "This page could not be loaded",
    text: "The admin service did not answer as expected. Try again in a moment; if it keeps happening, give the reference below to the platform team.",
    reference: "Reference {digest}",
  },
  time: {
    justNow: "just now",
    minutes: "{n} min",
    hours: "{n} h",
    days: { one: "{count} day", other: "{count} days" },
    future: "in {text}",
    past: "{text} ago",
    goodMorning: "Good morning",
    goodAfternoon: "Good afternoon",
    goodEvening: "Good evening",
  },
  /** Messages for API error codes (ADR-028 D15: the admin translates by code; EN = contract). */
  errors: {
    VALIDATION_FAILED: "The request is invalid.",
    AUTH_TOKEN_INVALID: "This link is invalid or has expired.",
    AUTH_INVALID_CREDENTIALS: "The e-mail address or password is incorrect.",
    AUTH_MFA_INVALID: "The verification code is incorrect.",
    AUTH_CHALLENGE_EXPIRED: "The sign-in attempt has expired. Please sign in again.",
    AUTH_SESSION_REQUIRED: "Please sign in.",
    AUTH_STEP_UP_REQUIRED: "Please confirm with your authenticator code.",
    AUTH_REAUTH_REQUIRED: "Please confirm your password.",
    AUTH_CSRF_REJECTED: "The request was rejected.",
    FORBIDDEN: "You are not allowed to do this.",
    NOT_FOUND: "Not found.",
    CONFLICT_LAST_ADMIN: "The last platform administrator cannot be removed.",
    CONFLICT_STATE: "This action is not possible in the current state.",
    PAYLOAD_TOO_LARGE: "The request is too large.",
    UNSUPPORTED_MEDIA_TYPE: "The request must be JSON.",
    AUTH_PASSWORD_POLICY: "The password does not meet the policy.",
    CONFIRMATION_MISMATCH: "The confirmation does not match.",
    RATE_LIMITED: "Too many attempts. Please try again later.",
    INTERNAL_ERROR: "Something went wrong.",
    BAD_GATEWAY: "The service is unavailable.",
    STORAGE_UNAVAILABLE: "File storage is not available right now. Try again later.",
  },
  auth: {
    railTitle: "One console for both sites.",
    railText:
      "Pages, product data sheets and staff access for dreampetroleumbv.com and the corporate site.",
    adminConsole: "Admin console",
    staffOnly: "Staff only. Every sign-in is recorded.",
    logoAlt: "Dream Petroleum BV, Energy in Motion",
    tooManyAttempts: "Too many attempts. Wait a few minutes before trying again.",
    unreachable: "The admin service could not be reached. Check your connection and try again.",
    cookiesBlocked:
      "This browser did not keep the secure sign-in cookie, so signing in cannot finish here. On a local development address (http://…localhost) Safari refuses such cookies: use Chrome or Firefox there, or the console's https address.",
    authenticatorCode: "Authenticator code",
    recoveryCode: "Recovery code",
    useRecoveryCode: "Use a recovery code instead",
    useAuthenticator: "Use the authenticator instead",
    checking: "Checking…",
    verifying: "Verifying…",
  },
  login: {
    metaTitle: "Sign in",
    title: "Sign in",
    intro: "Use your staff account. You will need your authenticator app.",
    lockedOut:
      "Locked out or lost your authenticator? Ask a platform administrator for a recovery link.",
    workEmail: "Work email",
    password: "Password",
    continue: "Continue",
    codeHelp: "Enter the 6-digit code from your authenticator app.",
    recoveryHelp:
      "Enter one of your saved recovery codes, for example ABCDE-12345. Each code works once.",
    signIn: "Sign in",
    startOver: "Start over",
    csrfRejected:
      "Sign-in is not allowed from this address. Open the admin console at its configured address and try again.",
    unavailable: "Sign-in is not available right now. Try again in a moment.",
  },
  link: {
    progress: "Progress",
    stepDone: "Done: ",
    stepCurrent: "Current step: ",
    stepNext: "Next: ",
    ruleMet: "Met: ",
    ruleNotMet: "Not met yet: ",
    showPassword: "Show {field}",
    hidePassword: "Hide {field}",
    goToSignIn: "Go to sign-in",
    checkingLink: "Checking your link…",
    passwordRules: "Password rules",
    bothMatch: "Both entries match",
    newPassword: "New password",
    repeatNewPassword: "Repeat new password",
    invalidTitle: "This link cannot be used",
    saving: "Saving…",
    policy: {
      too_short: "Use at least 12 characters.",
      too_long: "Use at most 128 characters.",
      breached: "This password appears in known data breaches. Choose a different one.",
      contains_identity: "Do not use your name or parts of your e-mail address.",
      requires_change: "Choose a password you have not used here before.",
    },
    failure: {
      link: "This link can no longer be used. It may have expired, been used already, or been replaced by a newer link. Ask a platform administrator for a new one.",
      policy: "Choose a stronger password.",
      credentials: "That is not your current password. Repeated mistakes end this link.",
      code: "That code is not correct. Repeated mistakes end this link.",
      state: "This step has to start again. Follow the instructions below.",
      other: "Something went wrong. Try again in a moment.",
    },
  },
  enrol: {
    metaTitle: "Account setup",
    railTitle: "Your access, set up securely.",
    railText:
      "A password only you know and an authenticator on your phone protect every sign-in to the console.",
    accountSetup: "Account setup",
    openLinkTitle: "Open your link",
    openLinkText:
      "This page works with the personal link from your invitation or from the operator. Open the full link again, exactly as you received it.",
    openLinkSafety:
      "For your safety the link is removed from the address bar as soon as the page opens, so copying the address from here does not work.",
    invalidText:
      "It may have expired, been used already, been replaced by a newer link, or been blocked after too many wrong attempts.",
    invalidAsk:
      "Ask a platform administrator for a new link. If you already finished setting up your account, sign in instead.",
    accountReady: "Account ready",
    doneTitle: "You are all set",
    doneText: "Your password and authenticator are set up. Sign in with them now.",
    doneCodes:
      "The recovery codes were shown once and are not stored in this browser. If you did not save them, ask a platform administrator for help.",
    unreachableTitle: "The admin service is not reachable",
    unreachableText: "Your link was not used. Check your connection and try again.",
    linkValidUntil: "Link valid until {date}",
    steps: {
      confirmPassword: "Confirm password",
      password: "Password",
      authenticator: "Authenticator",
      recoveryCodes: "Recovery codes",
    },
    setPassword: "Set password",
    currentPassword: "Current password",
    currentPasswordHint:
      "Your password did not change. Confirming it shows the reset reached the right person.",
    lengthRule: "{min} to {max} characters; a passphrase of several words works well",
    breachedRule: "Not a known breached password, and without your name or e-mail address.",
    confirmAndContinue: "Confirm and continue",
    savePasswordAndContinue: "Save password and continue",
    setupTimedOut: "The setup timed out. Remove the old entry from your app and scan the new code.",
    preparingKey: "Preparing your authenticator key…",
    scanStep: "1. Scan this code with your authenticator app",
    appExamples: "For example Microsoft Authenticator, Google Authenticator, 1Password or Authy.",
    qrLabel: "QR code for your authenticator app",
    cannotScan: "Cannot scan? Enter this key in the app instead:",
    keyCopied: "Key copied",
    copyKey: "Copy key",
    openInApp: "Open in authenticator app",
    confirmAuthenticator: "Confirm authenticator",
    enterCodeStep: "2. Enter the 6-digit code the app shows",
    phoneTime: "Check that the time on your phone is set automatically.",
    verifyAndActivate: "Verify and activate",
    reloadedNote:
      "Reloaded this page? A new key was created; only the newest entry in your app works.",
    accountActive: "Account active",
    codesTitle: "Save your recovery codes",
    codesText:
      "If your phone is lost, each code signs you in once instead of the authenticator. They are shown only now and cannot be displayed again.",
    codesLabel: "Recovery codes",
    downloadTxt: "Download .txt",
    copied: "Copied",
    copyAll: "Copy all",
    codesStored: "I have stored these codes somewhere safe, away from my phone.",
    continueToSignIn: "Continue to sign-in",
    codesFile: {
      heading: "Dream Petroleum admin console: recovery codes",
      account: "Account: {email}",
      once: "Each code works once, for sign-in when your authenticator is not at hand.",
      offline: "Keep this file offline and out of shared folders.",
    },
    kinds: {
      activation: {
        eyebrow: "Account activation",
        title: "Activate your account",
        intro:
          "Set a password and connect your authenticator app to finish setting up your account.",
      },
      invitation: {
        eyebrow: "Invitation",
        title: "Accept your invitation",
        intro:
          "You were invited to the Dream Petroleum admin console. Set a password and connect your authenticator app.",
      },
      recovery: {
        eyebrow: "Account recovery",
        title: "Recover your account",
        intro:
          "Your previous password, authenticator and recovery codes were cleared by the operator. Set new ones to sign in again.",
      },
      mfa_reenrolment: {
        eyebrow: "Authenticator reset",
        title: "Set up your authenticator again",
        intro:
          "An administrator reset your authenticator. Confirm your current password, then connect your authenticator app again.",
      },
    },
  },
  reset: {
    metaTitle: "Reset password",
    eyebrow: "Password reset",
    openLinkTitle: "Open your reset link",
    openLinkText:
      "This page works with the personal reset link from the operator. Open the full link again, exactly as you received it.",
    invalidText:
      "It may have expired, been used already, been replaced by a newer link, or been blocked after too many wrong attempts. Ask a platform administrator for a new one.",
    doneTitle: "Your password was changed",
    doneText:
      "All earlier sessions of your account were signed out. Sign in with the new password.",
    title: "Choose a new password",
    intro: "Your authenticator stays the same. You need it, or one recovery code, to confirm.",
    formLabel: "Reset password",
    lengthRule: "12 to 128 characters",
    changePassword: "Change password",
  },
} as const;
