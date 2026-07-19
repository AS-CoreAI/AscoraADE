import { ipcMain } from 'electron'
import { IPC, type PublicIpStatus, type VpnAuthRequest, type VpnAuthResult, type VpnConfigureRequest, type VpnConnectRequest, type VpnServersResult, type VpnStatus, type VpnTrafficResult } from '../../shared/ipc'
import { getPublicIpStatus } from '../network/public-ip'
import { configureVpn, connectVpn, disconnectVpn, fetchVpnServers, getVpnStatus, getVpnTraffic, loginVpnAccount, logoutVpnAccount, registerVpnAccount } from '../vpn/service'

export function registerNetworkVpnHandlers(): void {
  ipcMain.handle(IPC.network.publicIp, (_event, force = false): Promise<PublicIpStatus> =>
    getPublicIpStatus(force === true)
  )
  ipcMain.handle(IPC.vpn.status, (_event, forceDependencies = false): Promise<VpnStatus> =>
    getVpnStatus(forceDependencies === true)
  )
  ipcMain.handle(IPC.vpn.servers, (_event, force = false): Promise<VpnServersResult> =>
    fetchVpnServers(force === true)
  )
  ipcMain.handle(IPC.vpn.connect, (_event, request: VpnConnectRequest): Promise<VpnStatus> =>
    connectVpn(request)
  )
  ipcMain.handle(IPC.vpn.disconnect, (): Promise<VpnStatus> => disconnectVpn())
  ipcMain.handle(IPC.vpn.configure, (_event, request: VpnConfigureRequest): Promise<VpnStatus> =>
    configureVpn(request)
  )
  ipcMain.handle(IPC.vpn.login, (_event, request: VpnAuthRequest): Promise<VpnAuthResult> =>
    loginVpnAccount(request)
  )
  ipcMain.handle(IPC.vpn.register, (_event, request: VpnAuthRequest): Promise<VpnAuthResult> =>
    registerVpnAccount(request)
  )
  ipcMain.handle(IPC.vpn.logout, (): Promise<VpnAuthResult> => logoutVpnAccount())
  ipcMain.handle(IPC.vpn.traffic, (): Promise<VpnTrafficResult> => getVpnTraffic())
}
