// The settings every Kiro session Moûsa starts writes into its own KIRO_HOME (settings/cli.json, the file
// `kiro-cli settings` keeps): the session reads only the resources its agent names, and it never updates Kiro when
// it starts, so a study or a hosted try runs on the CLI version it was tested with (kiro-cli updated itself on this
// machine from 2.24 to 2.31 on 12 October 2026, and CLI 3.0, with its new engine, is due by the end of October).
export const KIRO_SESSION_SETTINGS = Object.freeze({ 'chat.disableInheritingDefaultResources': true, 'app.disableAutoupdates': true });

/** The settings file's text. */
export const kiroSessionSettings = () => JSON.stringify(KIRO_SESSION_SETTINGS);
