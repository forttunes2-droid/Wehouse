import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// ═══════════════════════════════════════════════════════════════
// PRIVACY POLICY — Public page, no login required
// One policy for the entire We House platform
// Content editable by Creator in Settings → Legal
// ═══════════════════════════════════════════════════════════════

const DEFAULT_POLICY = `**1. Introduction**

WeHouse ("we," "us," or "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, store, and protect your personal information when you use our platform.

**2. Information We Collect**

We collect information you provide directly (name, email, phone, address, payment details) and information collected automatically (IP address, device info, usage data).

**3. How We Use Information**

We use your information to provide and improve our services, process payments, verify identities, communicate with you, and ensure platform security.

**4. User Data**

Users (property seekers and renters): We collect contact details, search preferences, booking history, payment information, and communication records.

**5. Worker Data**

Workers: We collect personal information, skills, experience, government ID, verification videos, service history, ratings, and earnings.

**6. Property Partner Data**

Property Partners: We collect business information, property listings, bank account details for payouts, inspection reports, and transaction history.

**7. Staff Data**

Staff: We collect employment information, role assignments, activity logs, and performance data.

**8. Payments**

All payments are processed through Paystack. We do not store your card details. Payment data is encrypted and handled in accordance with PCI DSS standards.

**9. Identity Verification**

We may require government-issued ID and verification videos for workers and property partners. This data is stored securely and used solely for verification purposes.

**10. Security**

We implement industry-standard security measures including encryption, secure servers, and regular security audits to protect your data.

**11. Data Retention**

We retain your data for as long as your account is active or as needed to provide services. You may request data deletion by contacting support.

**12. User Rights**

You have the right to access, correct, delete, or export your personal data. Contact us at support@wehouse.ng for data requests.

**13. Contact Information**

For privacy-related questions, contact us at support@wehouse.ng or through the support channels listed on our platform.`;

export default function PrivacyPolicyPage() {
  const [content, setContent] = useState(DEFAULT_POLICY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'privacy_policy')
        .maybeSingle();
      if (data?.value) {
        setContent(data.value);
      }
      setLoading(false);
    }
    load();
  }, []);

  // Parse markdown-like bold text
  const renderContent = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, i) => {
      if (line.startsWith('**') && line.endsWith('**')) {
        return <h2 key={i} className="text-lg font-bold text-white mt-6 mb-3">{line.replace(/\*\*/g, '')}</h2>;
      }
      if (line.trim() === '') {
        return <div key={i} className="h-3" />;
      }
      // Handle inline bold
      const parts = line.split(/(\*\*.*?\*\*)/g);
      return (
        <p key={i} className="text-sm text-[#8A8B9C] leading-relaxed mb-2">
          {parts.map((part, j) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return <strong key={j} className="text-white">{part.replace(/\*\*/g, '')}</strong>;
            }
            return part;
          })}
        </p>
      );
    });
  };

  return (
    <div className="min-h-[100dvh] bg-[#0A0A0F]">
      <div className="max-w-2xl mx-auto px-5 py-8">
        {/* Back button */}
        <button onClick={() => window.history.back()} className="flex items-center gap-2 text-[#5C5E72] hover:text-white mb-6 text-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          Back
        </button>

        <h1 className="text-2xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-xs text-[#5C5E72] mb-8">Last updated: {new Date().toLocaleDateString()}</p>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-1">
            {renderContent(content)}
          </div>
        )}

        <div className="mt-10 pt-6 border-t border-[#2A2A3A]">
          <p className="text-xs text-[#5C5E72]">
            For questions about this Privacy Policy, contact us at{' '}
            <a href="mailto:support@wehouse.ng" className="text-[#3B82F6]">support@wehouse.ng</a>
          </p>
        </div>
      </div>
    </div>
  );
}
