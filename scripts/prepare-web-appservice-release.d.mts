export function createAppServiceZip(packageRoot: string, artifactPath: string): Promise<string>

export interface NpmInvocationOptions {
  platform?: NodeJS.Platform
  nodeExecutable?: string
  npmExecPath?: string
}

export interface NpmInvocation {
  command: string
  argsPrefix: string[]
}

export function resolveNpmInvocation(options?: NpmInvocationOptions): NpmInvocation
