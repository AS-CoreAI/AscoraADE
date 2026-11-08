export const EXTERNAL_FILES_SETTING = 'agent.allowExternalFiles'

/** Existing installations, like new ones, allow explicitly named external paths. */
export function externalFilesAllowed(value: unknown): boolean {
  return value !== false
}

export function agentFileAccessPrompt(allowed: boolean): string {
  return allowed
    ? 'External file access is enabled. list_dir, read_file, search_files, write_file and edit_file accept explicit absolute paths outside the project. Use external paths only when relevant to the user\'s task.'
    : 'External file access is disabled in Settings > General. File tools may only access paths inside the project. Do not bypass this preference through commands or TypeScript.'
}
