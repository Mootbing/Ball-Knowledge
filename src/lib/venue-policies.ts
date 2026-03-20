export interface PolicyItem {
  name: string;
  allowed: boolean;
}

export interface VenuePolicy {
  websiteUrl: string;
  policyUrl: string;
  clearBagRequired: boolean;
  maxBagSize: string;
  items: PolicyItem[];
}
