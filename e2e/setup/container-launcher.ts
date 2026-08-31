export const SUPPORT_E2E_IMAGE = 'support-dashboard-task22-e2e'
export const SUPPORT_E2E_PROVIDER_IP = '93.184.216.34'

export function dockerServerArguments({
  containerName,
  networkName,
  port,
  envFile,
  runtimeDirectory,
}: {
  containerName: string
  networkName: string
  port: string
  envFile: string
  runtimeDirectory: string
}): string[] {
  return [
    'run', '--rm', '--label', 'support.task22.e2e=1', '--name', containerName, '--network', networkName,
    '--ip', SUPPORT_E2E_PROVIDER_IP, '--add-host', 'host.docker.internal:host-gateway',
    '-p', `127.0.0.1:${port}:${port}`, '--env-file', envFile,
    '-v', `${runtimeDirectory}:/app/playwright/.runtime`, SUPPORT_E2E_IMAGE,
  ]
}
