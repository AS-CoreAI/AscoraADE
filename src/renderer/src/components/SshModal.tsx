import { useEffect, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { SshAuthType, SshConnection } from '@shared/ipc'
import { Icon } from './Icon'
import { useApp } from '@/state/store'
import { tr } from '@/language'

/** Add or edit a saved SSH connection (PEM key file or password auth). */
export function SshModal(): JSX.Element | null {
  const open = useApp((s) => s.sshModalOpen)
  const editing = useApp((s) => s.sshEditing)
  const close = useApp((s) => s.closeSshModal)
  const save = useApp((s) => s.saveSshConnection)
  const pickKey = useApp((s) => s.pickSshKey)
  const appLanguage = useApp((s) => s.appLanguage)
  const t = (key: Parameters<typeof tr>[1], values?: Record<string, string | number>): string =>
    tr(appLanguage, key, values)

  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [authType, setAuthType] = useState<SshAuthType>('key')
  const [keyPath, setKeyPath] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [password, setPassword] = useState('')

  // Seed the form whenever the modal opens (new = blank, edit = the connection).
  useEffect(() => {
    if (!open) return
    setName(editing?.name ?? '')
    setHost(editing?.host ?? '')
    setPort(String(editing?.port ?? 22))
    setUsername(editing?.username ?? '')
    setAuthType(editing?.authType ?? 'key')
    setKeyPath(editing?.keyPath ?? '')
    setPassphrase(editing?.passphrase ?? '')
    setPassword(editing?.password ?? '')
  }, [open, editing])

  if (!open) return null

  const canSave = host.trim() !== '' && username.trim() !== ''

  const submit = (): void => {
    if (!canSave) return
    const conn: SshConnection = {
      id: editing?.id ?? crypto.randomUUID(),
      name: name.trim() || `${username.trim()}@${host.trim()}`,
      host: host.trim(),
      port: Number(port) || 22,
      username: username.trim(),
      authType,
      keyPath: authType === 'key' ? keyPath.trim() || undefined : undefined,
      passphrase: authType === 'key' ? passphrase || undefined : undefined,
      password: authType === 'password' ? password : undefined
    }
    save(conn)
  }

  const browseKey = async (): Promise<void> => {
    const path = await pickKey()
    if (path) setKeyPath(path)
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal modal-ssh" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          {editing ? t('ssh.editTitle') : t('ssh.newTitle')}
          <button className="modal-close" title={t('common.close')} onClick={close}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="modal-body ssh-form">
          <label className="ssh-field">
            <span>{t('ssh.name')}</span>
            <input value={name} placeholder="My server" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="ssh-row">
            <label className="ssh-field" style={{ flex: 3 }}>
              <span>{t('ssh.host')}</span>
              <input
                value={host}
                placeholder="example.com or 1.2.3.4"
                onChange={(e) => setHost(e.target.value)}
              />
            </label>
            <label className="ssh-field" style={{ flex: 1 }}>
              <span>{t('ssh.port')}</span>
              <input value={port} onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))} />
            </label>
          </div>
          <label className="ssh-field">
            <span>{t('ssh.username')}</span>
            <input
              value={username}
              placeholder="root / ubuntu / ec2-user"
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>

          <div className="ssh-auth-toggle">
            <button
              className={authType === 'key' ? 'active' : ''}
              onClick={() => setAuthType('key')}
            >
              {t('ssh.privateKey')}
            </button>
            <button
              className={authType === 'password' ? 'active' : ''}
              onClick={() => setAuthType('password')}
            >
              {t('ssh.password')}
            </button>
          </div>

          {authType === 'key' ? (
            <>
              <label className="ssh-field">
                <span>{t('ssh.keyFile')}</span>
                <div className="ssh-row">
                  <input
                    value={keyPath}
                    placeholder="C:\\Users\\you\\key.pem"
                    onChange={(e) => setKeyPath(e.target.value)}
                  />
                  <button className="ssh-browse" onClick={() => void browseKey()}>
                    {t('ssh.browse')}
                  </button>
                </div>
              </label>
              <label className="ssh-field">
                <span>{t('ssh.passphrase')}</span>
                <input
                  type="password"
                  value={passphrase}
                  placeholder={t('ssh.passphrasePlaceholder')}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
              </label>
            </>
          ) : (
            <label className="ssh-field">
              <span>{t('ssh.password')}</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}

          <p className="ssh-note">
            {t('ssh.note')}
          </p>

          <div className="ssh-actions">
            <button className="ssh-cancel" onClick={close}>
              {t('common.cancel')}
            </button>
            <button className="ssh-save" disabled={!canSave} onClick={submit}>
              {editing ? t('common.save') : t('common.add')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
