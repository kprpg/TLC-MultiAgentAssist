export function createAppServiceZip(packageRoot: string, artifactPath: string): Promise<string>
export function createProductionInstallArgs(packageRoot: string): string[]
export function createLinuxCanvasInstallArgs(
  packageRoot: string,
  optionalDependencies: Record<string, string> | undefined
): string[]
export function resolveNpmInvocation(options?: {
  platform?: NodeJS.Platform
  nodeExecutable?: string
  npmExecPath?: string
}): { command: string; argsPrefix: string[] }
