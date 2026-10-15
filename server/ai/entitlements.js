/**
 * MindMap Studio — SaaS Plan Entitlement & Tier Management
 * 
 * Defines feature limits, pricing tiers, and server-side capability checks:
 * - Free: $0/forever (3 cloud mind maps, standard AI detail level, 4 expand items)
 * - Pro Monthly: $3.99/mo (Unlimited cloud maps, deep AI detail level, 6 expand items)
 * - Pro Yearly: $17.88/yr ($1.49/mo, 62% savings, priority AI queue)
 */

const TIERS = {
  free: {
    id: 'free',
    name: 'Free Starter',
    price: 0,
    priceFormatted: '$0',
    billingPeriod: 'forever',
    maxCloudProjects: 3,
    allowedDetailLevels: ['standard'],
    maxExpandChildren: 4,
    maxPromptLength: 800,
    isPro: false,
    features: [
      'Up to 3 Cloud Mind Maps',
      'Standard AI Generation (8–14 nodes)',
      'Expand Node with AI (up to 4 subtopics)',
      'Export to PNG, SVG, JSON & Standalone HTML',
      'Unlimited Local Storage & Offline Mode'
    ]
  },
  pro_monthly: {
    id: 'pro_monthly',
    name: 'Pro Monthly',
    price: 3.99,
    priceFormatted: '$3.99/mo',
    billingPeriod: 'month',
    maxCloudProjects: Infinity,
    allowedDetailLevels: ['standard', 'deep'],
    maxExpandChildren: 6,
    maxPromptLength: 800,
    isPro: true,
    features: [
      'Unlimited Cloud Mind Maps',
      'Deep AI Generation (15–25 comprehensive nodes)',
      'Advanced Node Expansion (up to 6 subtopics)',
      'Multi-Provider AI (Fal AI, Gemini, OpenAI, Claude)',
      'Cross-Device Instant Sync',
      'Priority AI Generation Speed'
    ]
  },
  pro_yearly: {
    id: 'pro_yearly',
    name: 'Pro Yearly',
    price: 17.88,
    priceFormatted: '$17.88/yr',
    monthlyEquivalentFormatted: '$1.49/mo',
    savingsBadge: 'Save 62%',
    billingPeriod: 'year',
    maxCloudProjects: Infinity,
    allowedDetailLevels: ['standard', 'deep'],
    maxExpandChildren: 6,
    maxPromptLength: 800,
    isPro: true,
    popular: true,
    features: [
      'All Pro Monthly Features Included',
      'Massive 62% Discount ($1.49/mo billed annually)',
      'Priority Processing Queue for AI Models',
      'Early Access to New Mind Map Templates & Themes',
      'Dedicated Community & Technical Support'
    ]
  }
};

/**
 * Get tier definition by ID (defaults to 'free' if invalid or missing)
 * @param {string} tierId
 * @returns {typeof TIERS.free}
 */
function getTier(tierId) {
  if (!tierId || typeof tierId !== 'string') return TIERS.free;
  const clean = tierId.toLowerCase().trim();
  return TIERS[clean] || TIERS.free;
}

/**
 * Checks whether user can create another cloud project under their current tier
 * @param {string} tierId
 * @param {number} currentCount
 * @returns {{ allowed: boolean, reason?: string, currentCount: number, maxAllowed: number }}
 */
function canCreateCloudProject(tierId, currentCount) {
  const tier = getTier(tierId);
  if (currentCount < tier.maxCloudProjects) {
    return {
      allowed: true,
      currentCount,
      maxAllowed: tier.maxCloudProjects
    };
  }

  return {
    allowed: false,
    currentCount,
    maxAllowed: tier.maxCloudProjects,
    reason: `You have reached the cloud project limit (${tier.maxCloudProjects} maps) on the Free Starter plan. Upgrade to Pro for unlimited cloud maps.`
  };
}

/**
 * Checks whether user's tier permits deep AI generation
 * @param {string} tierId
 * @param {string} detailLevel - 'standard' | 'deep'
 * @returns {{ allowed: boolean, effectiveDetailLevel: string, reason?: string }}
 */
function canUseAiDetailLevel(tierId, detailLevel) {
  const tier = getTier(tierId);
  const targetLevel = (detailLevel || 'standard').toLowerCase();

  if (tier.allowedDetailLevels.includes(targetLevel)) {
    return {
      allowed: true,
      effectiveDetailLevel: targetLevel
    };
  }

  return {
    allowed: false,
    effectiveDetailLevel: 'standard',
    reason: `Deep AI generation (15–25 nodes) is a Pro feature. Generating with Standard detail level on Free plan.`
  };
}

/**
 * Validates maximum child nodes user can generate per node expansion
 * @param {string} tierId
 * @param {number} requestedCount
 * @returns {{ count: number, capped: boolean, reason?: string }}
 */
function getEffectiveExpandCount(tierId, requestedCount) {
  const tier = getTier(tierId);
  const count = parseInt(requestedCount, 10) || 4;

  if (count <= tier.maxExpandChildren) {
    return { count, capped: false };
  }

  return {
    count: tier.maxExpandChildren,
    capped: true,
    reason: `Node expansion capped at ${tier.maxExpandChildren} subtopics on the ${tier.name} plan. Upgrade to Pro for up to 6 subtopics.`
  };
}

/**
 * Returns structured plan comparison data for UI modal rendering
 */
function getPlansCatalog() {
  return [TIERS.free, TIERS.pro_monthly, TIERS.pro_yearly];
}

module.exports = {
  TIERS,
  getTier,
  canCreateCloudProject,
  canUseAiDetailLevel,
  getEffectiveExpandCount,
  getPlansCatalog
};
