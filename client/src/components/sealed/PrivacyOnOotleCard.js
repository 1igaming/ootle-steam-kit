import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import ConfirmationNumberOutlinedIcon from '@mui/icons-material/ConfirmationNumberOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import SectionHeader from './SectionHeader';
import { raisedSx } from './ViewBoard';

/**
 * "Privacy on Ootle" for the How it works view. Shielding is operational in
 * the wallet now, so this teaches the two instruments people can actually
 * try — and what each one looks like on the Esmeralda chain.
 */

const ink = '#0f172a';
const muted = '#64748b';

const INSTRUMENTS = [
  {
    Icon: LockOutlinedIcon,
    title: 'Stealth tTARI',
    badge: 'Amount hidden',
    badgeStyle: { bg: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8' },
    lead: 'Stays at your address with its amount behind a cryptographic commitment.',
    copy: 'On chain, a stealth shield reads as your account sending itself a hidden amount. The amount is hidden; the account is not. Unshield any part of it at any time and it drops straight back into your revealed, spendable balance.'
  },
  {
    Icon: ConfirmationNumberOutlinedIcon,
    title: 'Vouchers',
    badge: 'Amount + owner hidden',
    badgeStyle: { bg: '#ecfdf5', border: '#a7f3d0', color: '#047857' },
    lead: 'Fixed 1, 10, 100 and 1,000 tTARI denominations.',
    copy: 'The deposit into the pool is public; anyone watching the chain sees it. But the vouchers you receive after are private bearer claims that never touch the chain again until you redeem them. Held-for-now guidance: the longer they sit and the busier the pool, the weaker the deposit-to-spend pairing gets.'
  }
];

const CHAIN_SEES = [
  {
    Icon: LockOutlinedIcon,
    title: 'Shield into stealth',
    copy: 'One transaction with a blinded output. The amount never appears on chain.'
  },
  {
    Icon: VisibilityOutlinedIcon,
    title: 'Shield into vouchers',
    copy: 'One transaction with the amount in the clear. That public spend is what the vouchers buy their privacy with.'
  },
  {
    Icon: ReceiptLongOutlinedIcon,
    title: 'Fees',
    copy: 'Always revealed in the clear. That is the privacy floor on every chain, Ootle included.'
  },
  {
    Icon: KeyOutlinedIcon,
    title: 'Who signs',
    copy: 'On Esmeralda the site escrow signs the on-chain leg for you. When in-wallet signing ships with the Ootle mainnet launch, your browser wallet signs it itself: same flow, your keys.'
  }
];

export default function PrivacyOnOotleCard({ sx }) {
  return (
    <Box sx={{ minWidth: 0, ...(sx || {}) }} id="ootle-privacy-card">
      <SectionHeader
        eyebrow="Privacy on Ootle"
        title="Stealth tTARI and vouchers"
        copy="Two instruments hide value on the Tari L2. Both are live in the Wallet tab today: shield with either one and watch the difference on Esmeralda."
      />

      <Box sx={{ display: 'grid', gap: 1.5, mt: 2 }}>
        {INSTRUMENTS.map(({ Icon, title, badge, badgeStyle, lead, copy }) => (
          <Box key={title} sx={{ ...raisedSx, p: { xs: 1.75, sm: 2 }, display: 'grid', gap: 0.75 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Box sx={{ width: 34, height: 34, borderRadius: 2, display: 'grid', placeItems: 'center', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#2563eb', flexShrink: 0 }}>
                <Icon sx={{ fontSize: 18 }} />
              </Box>
              <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: ink }}>{title}</Typography>
              <Box component="span" sx={{ px: 1.25, py: 0.35, borderRadius: 999, background: badgeStyle.bg, border: `1px solid ${badgeStyle.border}`, color: badgeStyle.color, fontSize: '0.7rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
                {badge}
              </Box>
            </Box>
            <Typography sx={{ color: '#1e293b', fontSize: '0.86rem', fontWeight: 700 }}>{lead}</Typography>
            <Typography sx={{ color: muted, fontSize: '0.84rem', lineHeight: 1.55 }}>{copy}</Typography>
          </Box>
        ))}
      </Box>

      <Box sx={{ ...raisedSx, mt: 1.5, p: { xs: 1.75, sm: 2 }, display: 'grid', gap: 1.25 }}>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: muted }}>
          What the chain sees
        </Typography>
        {CHAIN_SEES.map(({ Icon, title, copy }) => (
          <Box key={title} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, minWidth: 0 }}>
            <Box sx={{ width: 28, height: 28, borderRadius: 1.5, display: 'grid', placeItems: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', color: '#2563eb', flexShrink: 0 }}>
              <Icon sx={{ fontSize: 15 }} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 800, fontSize: '0.84rem', color: ink }}>{title}</Typography>
              <Typography sx={{ color: muted, fontSize: '0.82rem', lineHeight: 1.5 }}>{copy}</Typography>
            </Box>
          </Box>
        ))}
      </Box>

      <Box sx={{ mt: 1.5, p: 1.5, borderRadius: 2, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
        <Typography sx={{ color: '#334155', fontSize: '0.84rem', lineHeight: 1.55 }}>
          Under the hood, outputs are bearer instruments: control follows the keys in this browser, with no owner
          registry anywhere. At launch, a view key can disclose balances to an auditor you choose without giving
          anyone spending power. Privacy here is a property of the whole flow, not of a token.
        </Typography>
      </Box>
    </Box>
  );
}
