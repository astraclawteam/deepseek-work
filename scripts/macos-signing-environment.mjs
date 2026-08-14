/** Normalize electron-builder's macOS signing environment. */
export function prepareMacOSSigningEnvironment(source) {
  const environment = { ...source }
  const hasDeveloperId = Boolean(environment.CSC_LINK?.trim())
  if (!hasDeveloperId) {
    delete environment.CSC_LINK
    delete environment.CSC_KEY_PASSWORD
  }
  return { environment, hasDeveloperId }
}
