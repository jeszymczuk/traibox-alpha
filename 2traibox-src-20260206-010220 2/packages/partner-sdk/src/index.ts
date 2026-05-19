import type { OfferItem, OfferRequest, UUID } from '@traibox/contracts';

export type PartnerDomain = 'finance' | 'payments' | 'logistics' | 'compliance' | 'identity';

export interface PartnerProfile {
  partner_id: string;
  display_name: string;
  domains: PartnerDomain[];
  corridors?: string[];
  rails?: string[];
  stf_ready?: boolean;
  webhook_url?: string;
  push_mode?: boolean;
}

export interface OfferRequestRecord {
  request_id: UUID;
  trade_id: UUID;
  corridor?: string;
  amount: number;
  currency: string;
  tenor_days: number;
  sustainable?: OfferRequest['sustainable'];
  created_at: string;
}

export interface SubmitOffersRequest {
  offers: Array<
    Omit<OfferItem, 'offer_id'> & {
      offer_id?: UUID;
      partner_offer_ref?: string;
    }
  >;
}

