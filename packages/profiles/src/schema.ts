import { z } from 'zod';

const EvmHexAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .describe('EVM address');

export const ProfileSchema = z.object({
  profile_id: z.string().min(1),
  region: z.string().min(1).default('eu-iberia'),

  features: z
    .object({
      tradebrain_llm_enabled: z.boolean().default(false),
      ledger_anchoring_enabled: z.boolean().default(false)
    })
    .default({}),

  tradebrain: z
    .object({
      default_corridor: z.string().min(3).default('EU-EU'),
      incoterms_default: z.string().min(1).default('DAP'),
      hs_thresholds: z
        .object({
          confident: z.number().min(0).max(1).default(0.7),
          ambiguous: z.number().min(0).max(1).default(0.4)
        })
        .default({})
    })
    .default({}),

  compliance: z
    .object({
      complyadvantage: z
        .object({
          enabled: z.boolean().default(false),
          base_url: z.string().url().optional()
        })
        .default({})
    })
    .default({}),

  kyb: z
    .object({
      mode: z.enum(['lite', 'sumsub']).default('lite'),
      sumsub: z
        .object({
          enabled: z.boolean().default(false),
          base_url: z.string().url().optional()
        })
        .default({})
    })
    .default({}),

  finance: z
    .object({
      demo_offers_enabled: z.boolean().default(true),
      stf: z
        .object({
          enabled: z.boolean().default(true),
          default_path: z.enum(['uop', 'sltf']).default('uop'),
          minimum_grade: z.enum(['eligible', 'aligned']).default('eligible')
        })
        .default({}),
      prime_policy_id: z.string().default('fin_v1')
    })
    .default({}),

  payments: z
    .object({
      rails_preference: z.array(z.string()).default(['SEPA_INSTANT', 'SEPA']),
      manual: z
        .object({
          enabled: z.boolean().default(true),
          allow_completion: z.boolean().default(true)
        })
        .default({}),
      defaults: z
        .object({
          sepa_fee: z.number().default(0.2),
          sepa_eta_minutes: z.number().int().default(1440),
          sepa_instant_fee: z.number().default(1.2),
          sepa_instant_eta_minutes: z.number().int().default(2)
        })
        .default({}),
      truelayer: z
        .object({
          enabled: z.boolean().default(false),
          base_url: z.string().url().optional(),
          payments_path: z.string().min(1).default('/payments'),
          webhooks: z
            .object({
              verify_signatures: z.boolean().default(true)
            })
            .default({})
        })
        .default({})
    })
    .default({}),

  ledger: z
    .object({
      anchoring: z
        .object({
          enabled: z.boolean().default(false),
          network: z.string().default('xdc'),
          chain_id: z.number().int().default(50),
          confirmations: z.number().int().default(3),
          registry_address: EvmHexAddress.optional(),
          fee_budget_per_root_wei: z.string().optional()
        })
        .default({})
    })
    .default({}),

  pilot: z
    .object({
      controlled_rollout: z.boolean().default(false),
      target_smes: z.number().int().positive().default(1),
      required_smoke_scenarios: z.array(z.string().min(1)).default(['full_trade_room_loop']),
      degraded_mode: z
        .object({
          manual_payment_fallback_required: z.boolean().default(true),
          partner_offer_fallback_required: z.boolean().default(true),
          allow_llm_disabled: z.boolean().default(true)
        })
        .default({})
    })
    .default({})
});

export type Profile = z.infer<typeof ProfileSchema>;
