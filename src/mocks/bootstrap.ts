import {
  isH5DevServer,
  readRuntimeBuildEnvironment,
  type RuntimeBuildEnvironment,
  type RuntimeConfig
} from '@/config/runtime'
import {
  MOCK_SCENARIO_NAMES,
  createMockFixture,
  type MockBootstrapData,
  type MockScenarioName
} from './fixtures'

export interface BootstrapMocksOptions {
  scenario?: string
  search?: string
  environment?: RuntimeBuildEnvironment
}

const DEFAULT_SCENARIO: MockScenarioName = 'library'
const UNKNOWN_SCENARIO_FALLBACK: MockScenarioName = 'first-run'

export function bootstrapMocks(
  config: Pick<RuntimeConfig, 'useMocks'>,
  options: BootstrapMocksOptions = {}
): MockBootstrapData | null {
  if (!config.useMocks) {
    return null
  }

  let environment: RuntimeBuildEnvironment
  try {
    environment = options.environment ?? readRuntimeBuildEnvironment()
  } catch {
    return null
  }

  if (!isH5DevServer(environment)) {
    return null
  }

  const scenario = resolveScenario(options)
  return createMockFixture(scenario)
}

function resolveScenario(options: BootstrapMocksOptions): MockScenarioName {
  let injectedScenario: string | undefined
  try {
    injectedScenario = options.scenario
  } catch {
    return UNKNOWN_SCENARIO_FALLBACK
  }

  if (injectedScenario !== undefined) {
    return isMockScenario(injectedScenario)
      ? injectedScenario
      : UNKNOWN_SCENARIO_FALLBACK
  }

  let search: string | undefined
  try {
    search = options.search ?? readH5Search()
  } catch {
    return DEFAULT_SCENARIO
  }

  if (!search) {
    return DEFAULT_SCENARIO
  }

  let queryScenario: string | null
  try {
    queryScenario = new URLSearchParams(search.slice(0, 2048)).get('scenario')
  } catch {
    return UNKNOWN_SCENARIO_FALLBACK
  }

  if (queryScenario === null) {
    return DEFAULT_SCENARIO
  }

  return isMockScenario(queryScenario)
    ? queryScenario
    : UNKNOWN_SCENARIO_FALLBACK
}

function readH5Search(): string | undefined {
  return typeof globalThis.location === 'object' &&
    typeof globalThis.location.search === 'string'
    ? globalThis.location.search
    : undefined
}

function isMockScenario(value: string): value is MockScenarioName {
  return (MOCK_SCENARIO_NAMES as readonly string[]).includes(value)
}

export type { MockBootstrapData, MockScenarioName } from './fixtures'
