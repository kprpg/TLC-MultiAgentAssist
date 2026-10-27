import { readFileSync, writeFileSync } from 'node:fs'

const [command, ...args] = process.argv.slice(2)
const statePath = process.env.TLC_APP_SERVICE_TEST_STATE
if (!statePath) throw new Error('This fixture requires an isolated test state file.')
const state = JSON.parse(readFileSync(statePath, 'utf8'))
const flag = (name) => args[args.indexOf(name) + 1]
const target = args.includes('--slot') ? flag('--slot') : 'production'
const starts = (value) => args.slice(0, value.split(' ').length).join(' ') === value
state.calls.push({
  command, args,
  productionDeployment: state.deployments.production.id,
  productionAuth: state.auth.production.enabled,
  productionRequireAuthentication: state.auth.production.requireAuthentication,
  productionMode: state.settings.production.TLC_WEB_MODE ?? null
})

function output(value) {
  if (flag('--output') !== 'none') console.log(JSON.stringify(value))
}

function settingsArguments(name) {
  const start = args.indexOf(name) + 1
  const end = args.findIndex((value, index) => index >= start && value.startsWith('--'))
  return args.slice(start, end < 0 ? undefined : end)
}

try {
  if (command === 'node') {
    if (args.includes('--url')) {
      const scope = flag('--url').includes('demo-sample.') ? 'sample' : 'production'
      if (state.failVerification || (state.failProductionVerification && scope === 'production')) {
        if (scope === 'production') state.auth.production.requireAuthentication = false
        throw new Error('Mock anonymous verification failed.')
      }
      if (state.auth[scope].enabled || state.settings[scope].TLC_WEB_MODE !== 'sample'
          || state.settings[scope].TLC_DATA_STORE !== 'sqlite') throw new Error('Mock target is not anonymous SQLite sample.')
    } else if (args.includes('--access-url')) {
      if ((state.auth.production.enabled && state.auth.production.requireAuthentication) !== args.includes('--protected')) throw new Error('Mock restored policy does not match.')
    } else throw new Error('Unexpected Node invocation; build and network access are not mocked.')
  } else if (command !== 'az') throw new Error('Unknown test command.')
  else if (starts('account show')) output({ tenantId: state.tenantId })
  else if (starts('appservice plan show')) output(state.plan)
  else if (starts('webapp show')) {
    if (!state.sites[target]) throw new Error('Mock slot does not exist.')
    output(state.sites[target])
  } else if (starts('webapp deployment slot list')) output(Object.keys(state.sites).filter((slot) => slot !== 'production').map((name) => ({ name })))
  else if (starts('webapp log deployment list')) output([state.deployments[target]])
  else if (starts('webapp deployment slot create')) {
    if (args.includes('--configuration-source')) throw new Error('Do not clone live configuration into the demo.')
    state.sites[target] = { ...state.sites.production, name: target, defaultHostName: 'demo-sample.example.test' }
    state.settings[target] = {}
    state.auth[target] = { version: 'v1', enabled: false, requireAuthentication: false, excludedPaths: [] }
    state.deployments[target] = { id: 'empty-slot', status: 4, active: true }
  } else if (starts('webapp config set')) state.sites[target].siteConfig.linuxFxVersion = flag('--linux-fx-version')
  else if (starts('webapp config appsettings set')) {
    for (const setting of settingsArguments('--settings')) {
      const separator = setting.indexOf('=')
      state.settings[target][setting.slice(0, separator)] = setting.slice(separator + 1)
      state.sticky = state.sticky.filter((name) => name !== setting.slice(0, separator))
    }
  } else if (starts('webapp config appsettings delete')) {
    for (const name of settingsArguments('--setting-names')) {
      delete state.settings[target][name]
      state.sticky = state.sticky.filter((sticky) => sticky !== name)
    }
  } else if (starts('webapp auth update') || starts('webapp auth-classic update')) {
    if (starts('webapp auth update') && state.auth[target].version === 'v1') {
      throw new Error('Cannot use auth v2 commands when the app is using auth v1.')
    }
    if (starts('webapp auth-classic update') && state.auth[target].version !== 'v1') {
      throw new Error('Classic auth commands cannot update an auth v2 app.')
    }
    if (args.includes('--enabled')) {
      if (target === 'production' && flag('--enabled') === 'false' && state.settings.production.TLC_WEB_MODE !== 'sample') {
        throw new Error('Attempted to expose live production.')
      }
      if (args.includes('--action')) {
        state.auth[target].requireAuthentication = flag('--action') !== 'AllowAnonymous'
        state.auth[target].unauthenticatedClientAction = flag('--action')
      }
      state.auth[target].enabled = flag('--enabled') === 'true'
    }
    if (args.includes('--excluded-paths')) state.auth[target].excludedPaths = JSON.parse(flag('--excluded-paths'))
  } else if (starts('webapp update')) state.sites[target].httpsOnly = flag('--https-only') === 'true'
  else if (starts('webapp deploy')) {
    state.deployments[target] = { id: `deployment-${++state.sequence}`, status: state.failDeployment ? 3 : 4, active: true, status_text: 'mock deployment failure' }
    if (state.acceptedCliFailure) process.exitCode = 1
  } else if (starts('webapp deployment slot swap')) {
    if (state.failSwap) throw new Error('Mock swap failed before routing changed.')
    if (state.auth.production.enabled && !state.auth.production.excludedPaths.includes('/api/health')) throw new Error('Protected warm-up did not exclude the non-sensitive health route.')
    for (const key of new Set([...Object.keys(state.settings.production), ...Object.keys(state.settings[target])])) {
      if (state.sticky.includes(key)) continue
      const original = state.settings.production[key]
      if (state.settings[target][key] === undefined) delete state.settings.production[key]
      else state.settings.production[key] = state.settings[target][key]
      if (original === undefined) delete state.settings[target][key]
      else state.settings[target][key] = original
    }
    const previousDeployment = state.deployments.production
    state.deployments.production = state.deployments[target]
    state.deployments[target] = previousDeployment
  } else if (starts('rest')) {
    const url = new URL(flag('--url'))
    const slot = /\/slots\/([^/]+)\//.exec(url.pathname)?.[1] ?? 'production'
    if (url.pathname.endsWith('/authsettings/list')) {
      const auth = state.auth[slot]
      const action = Object.hasOwn(auth, 'unauthenticatedClientAction') ? auth.unauthenticatedClientAction
        : auth.requireAuthentication ? 'RedirectToLoginPage' : 'AllowAnonymous'
      output(flag('--query') === 'properties' ? {
        configVersion: auth.version, enabled: auth.enabled, unauthenticatedClientAction: action,
        clientId: 'keep-classic-provider-registration'
      } : { version: auth.version, enabled: auth.enabled, unauthenticatedClientAction: action })
    } else if (url.pathname.endsWith('/authsettings')) {
      const properties = JSON.parse(readFileSync(flag('--body').slice(1), 'utf8')).properties
      if (flag('--method') !== 'put' || properties.configVersion !== 'v1'
          || typeof properties.enabled !== 'boolean' || properties.clientId !== 'keep-classic-provider-registration') {
        throw new Error('Classic auth restoration must preserve its version, providers and boolean types.')
      }
      state.auth[slot].enabled = properties.enabled
      state.auth[slot].requireAuthentication = properties.unauthenticatedClientAction !== 'AllowAnonymous'
      state.auth[slot].unauthenticatedClientAction = properties.unauthenticatedClientAction
    } else if (url.pathname.endsWith('/authsettingsV2')) {
      if (flag('--method') === 'put') {
        const properties = JSON.parse(readFileSync(flag('--body').slice(1), 'utf8')).properties
        if (typeof properties.globalValidation.requireAuthentication !== 'boolean'
            || typeof properties.platform.enabled !== 'boolean'
            || properties.identityProviders?.registration !== 'keep-provider-registration') throw new Error('Auth policy must preserve providers and boolean types.')
        state.auth[slot].enabled = properties.platform.enabled
        state.auth[slot].requireAuthentication = properties.globalValidation.requireAuthentication
      } else if (flag('--query') === 'properties') {
        output({
          platform: { enabled: state.auth[slot].enabled },
          globalValidation: { requireAuthentication: state.auth[slot].requireAuthentication, excludedPaths: state.auth[slot].excludedPaths },
          identityProviders: { registration: 'keep-provider-registration' }
        })
      } else output(state.auth[slot])
    }
    else if (url.pathname.endsWith('/slotConfigNames')) {
      if (flag('--method') === 'put') state.sticky = JSON.parse(readFileSync(flag('--body').slice(1), 'utf8')).properties.appSettingNames
      else output(flag('--query') === 'properties' ? { appSettingNames: state.sticky, connectionStringNames: ['untouched-connection'] } : state.sticky)
    }
    else if (url.pathname.endsWith('/appsettings/list')) {
      const names = flag('--query').slice(1, -1).split(',').map((field) => field.split(':')[0])
      output(Object.fromEntries(names.map((name) => [name, state.settings[slot][name] ?? null])))
    } else throw new Error('Unexpected ARM request.')
  } else throw new Error(`Unmocked Azure command: ${args.slice(0, 4).join(' ')}`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  writeFileSync(statePath, JSON.stringify(state))
}
