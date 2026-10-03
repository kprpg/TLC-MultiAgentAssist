import { z } from 'zod'

/**
 * Solution Engineer domains used to route MSX opportunity discovery.
 *
 * The classification is derived from the MSX `opportunity` Dataverse schema:
 * `msp_solutionarea` is too coarse to separate Infrastructure, Data, and
 * AI/Apps work (all three fall under "Cloud and AI Platforms"), so the fine
 * grained `msp_technicalcapability` choice is used as the primary discriminator.
 */
export const seDomainIds = ['infra', 'data', 'ai-apps', 'security', 'modern-work', 'biz-apps', 'devices', 'services'] as const

export type SeDomainId = (typeof seDomainIds)[number]

export const seDomainSchema = z.enum(seDomainIds)

export interface SeDomainDefinition {
  readonly id: SeDomainId
  readonly label: string
  readonly description: string
  /** `msp_solutionarea` option codes that gate this domain. */
  readonly solutionAreaCodes: readonly number[]
  /** `msp_technicalcapability` option codes that identify this domain (primary discriminator). */
  readonly technicalCapabilityCodes: readonly number[]
  /** `msp_conversation` option codes used as a secondary signal when technical capability is unset. */
  readonly conversationCodes: readonly number[]
}

/**
 * `msp_solutionarea` option code for "Cloud and AI Platforms". All three SE
 * domains sit under this single solution area, so it is shared across them and
 * used only as a coarse gate.
 */
const CLOUD_AND_AI_PLATFORMS = 394380000

export const seDomainDefinitions: Readonly<Record<SeDomainId, SeDomainDefinition>> = {
  infra: {
    id: 'infra',
    label: 'Infrastructure',
    description: 'Azure infrastructure, migration, networking, and hybrid/edge opportunities.',
    solutionAreaCodes: [CLOUD_AND_AI_PLATFORMS],
    technicalCapabilityCodes: [
      861980000, // Advanced Networking
      861980074, // Azure Arc
      861980075, // Azure Stack Edge
      861980076, // Azure Stack Hub
      861980005, // Azure VMware Solutions
      861980029, // Citrix Cloud on Azure
      861980011, // Cloud Adoption Framework
      861980008, // Cloud to Cloud Migration
      861980015, // High Performance Compute
      861980024, // SAP on Azure
      861980030, // VMware Horizon Cloud Service for Azure
      861980072, // Well Architected
      861980028, // WVD Native (Azure Virtual Desktop)
      861980026, // Windows & SQL Server Migration to Azure
      861980019, // Linux & OSS DB Migration to Azure
      861980018, // IoT
      861980014 // Gaming
    ],
    conversationCodes: [
      884800006, // Modernize with confidence
      884800001 // Ubiquitous Innovation
    ]
  },
  data: {
    id: 'data',
    label: 'Data',
    description: 'Analytics, data platform, and database modernization opportunities.',
    solutionAreaCodes: [CLOUD_AND_AI_PLATFORMS],
    technicalCapabilityCodes: [
      861980073, // Appliance Migration to Azure Synapse
      861980077, // Cloud Scale Analytics
      861980085, // New Analytics with Synapse & PowerBI
      861980020, // OSS DB Migration to Azure OSS DB
      861980049, // Power BI
      861980027 // SQL Server Migration to Azure SQL MI
    ],
    conversationCodes: [
      884800007, // Build a unified governed data and AI estate
      884800015, // Modernize your data to drive results and leverage AI
      884800002 // Amplify your intelligence
    ]
  },
  'ai-apps': {
    id: 'ai-apps',
    label: 'AI & Apps',
    description: 'AI, machine learning, app modernization, and cloud-native application opportunities.',
    solutionAreaCodes: [CLOUD_AND_AI_PLATFORMS],
    technicalCapabilityCodes: [
      861980002, // Azure AI and ML
      861980009, // DevOps with GitHub
      861980023, // Modernize .NET Apps with App Service, Azure SQL DB
      861980007, // Modernize/New Cloud Native Apps with AKS and Azure Cosmos/Postgres DB
      861980071, // Custom Solutions
      861980041, // Power Apps
      861980082 // Power Virtual Agents
    ],
    conversationCodes: [
      884800000, // AI in the flow of human ambition
      884800012 // Create a competitive edge with AI
    ]
  },
  security: {
    id: 'security',
    label: 'Security',
    description: 'Security, identity, threat protection, and information governance opportunities.',
    solutionAreaCodes: [861980005], // Security
    technicalCapabilityCodes: [
      861980063, // Cloud Security
      861980059, // Identity & Access Management
      861980054, // Information Protection & Governance
      861980056, // Insider Risk
      861980062, // Threat Protection
      861980052, // Fraud Protection
      861980061 // Mobile Device Management
    ],
    conversationCodes: [
      884800003, // Establish a trusted and secure platform for AI
      884800013 // Run your business securely
    ]
  },
  'modern-work': {
    id: 'modern-work',
    label: 'Modern Work',
    description: 'Teams, collaboration, frontline, and workplace productivity opportunities.',
    solutionAreaCodes: [],
    technicalCapabilityCodes: [
      861980068, // Calling
      861980057, // Firstline Workers
      861980058, // Knowledge & Insights
      861980067, // Meeting Rooms
      861980086, // Meetings
      861980069, // Teams Store Apps
      861980065, // Teamwork Deployment
      861980084, // Workplace Analytics
      861980070 // Power Platform for Teams
    ],
    conversationCodes: [
      884800004, // AI-ready productivity and security for every employee
      884800011 // Power your business with secure AI integrated into your flow of work
    ]
  },
  'biz-apps': {
    id: 'biz-apps',
    label: 'BizApps / Power Platform / D365',
    description: 'Dynamics 365 and Power Platform business application opportunities.',
    solutionAreaCodes: [394380002], // AI Business Solutions
    technicalCapabilityCodes: [
      861980034, // Commerce
      861980050, // Customer Insights
      861980046, // Customer Service
      861980047, // Field Service
      861980051, // Finance
      861980078, // Forms Pro
      861980035, // HR
      861980032, // Marketing
      861980079, // Migration On-Prem to Manage Financial Risk
      861980080, // Migration On-Prem to Supply Chain Management
      861980081, // Power Automate
      861980083, // Project Operations
      861980031, // Sales
      861980033 // Supply Chain Management
    ],
    conversationCodes: [
      884800005, // Agentify your business processes
      884800014 // Scale business processes with agent-powered finance
    ]
  },
  devices: {
    id: 'devices',
    label: 'Devices / Mixed Reality',
    description: 'Surface, device deployment/management, and mixed reality opportunities.',
    solutionAreaCodes: [861980012], // Windows and Devices
    technicalCapabilityCodes: [
      861980064, // Surface & Partner Devices
      861980060, // Device Deployment & Management
      861980022 // Mixed Reality
    ],
    conversationCodes: [
      884800009 // AI Transformation with Surface and Copilot
    ]
  },
  services: {
    id: 'services',
    label: 'Services',
    description: 'Microsoft advisory and consulting services opportunities.',
    solutionAreaCodes: [861980011], // Microsoft Services
    technicalCapabilityCodes: [
      861980055 // Advisory Services
    ],
    conversationCodes: [
      884800008 // Accelerate AI Transformation with Microsoft Services
    ]
  }
}

export const seDomainList: readonly SeDomainDefinition[] = seDomainIds.map((id) => seDomainDefinitions[id])

export function getSeDomainDefinition(id: SeDomainId): SeDomainDefinition {
  return seDomainDefinitions[id]
}
