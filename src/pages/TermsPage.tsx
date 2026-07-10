import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// ═══════════════════════════════════════════════════════════════
// TERMS & CONDITIONS — Public page, no login required
// One document for the entire We House platform
// Content editable by Creator in Settings → Legal
// ═══════════════════════════════════════════════════════════════

const DEFAULT_TERMS = `**1. Introduction**

Welcome to WeHouse. These Terms and Conditions govern your use of our platform. By accessing or using WeHouse, you agree to these terms.

**2. Definitions**

"Platform" means the WeHouse website and mobile application. "User" means anyone who uses the platform. "Worker" means service providers registered on the platform. "Property Partner" means individuals or companies listing properties. "Staff" means WeHouse employees or contractors.

**3. Account Registration**

You must provide accurate information when creating an account. You are responsible for maintaining the confidentiality of your account credentials.

**4. User Responsibilities**

Users must use the platform lawfully, respect other users, and provide accurate information. Users are responsible for their interactions with workers and property partners.

**5. Worker Terms**

Workers must provide accurate skills and qualifications. Workers must complete the verification process before offering services. Workers are independent contractors, not employees of WeHouse.

**6. Property Partner Terms**

Property partners must provide accurate property information. All properties must pass WeHouse inspection before listing. Partners are responsible for property maintenance and legal compliance.

**7. Payments**

All payments are processed through Paystack. WeHouse charges commissions as configured by the platform Creator. Payouts to workers and partners are made according to the withdrawal schedule.

**8. Cancellations and Refunds**

Cancellation and refund policies are set by the Creator in platform settings. Users should review these policies before making bookings.

**9. Prohibited Activities**

Users may not: engage in fraud, harass others, list false information, circumvent platform fees, or use the platform for illegal activities.

**10. Termination**

WeHouse reserves the right to suspend or terminate accounts that violate these terms. Users may delete their account at any time (subject to pending obligations).

**11. Limitation of Liability**

WeHouse facilitates connections but is not responsible for the quality of services, property conditions, or user interactions. Use the platform at your own risk.

**12. Changes to Terms**

We may update these terms at any time. Continued use of the platform after changes constitutes acceptance of the updated terms.

**13. Contact**

For questions about these terms, contact support@wehouse.ng.`;

export default function TermsPage() {
  const [content, setContent] = useState(DEFAULT_TERMS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'terms_of_service')
        .maybeSingle();
      if (data?.value) {
        setContent(data.value);
      }
      setLoading(false);
    }
    load();
  }, []);

  const renderContent = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, i) => {
      if (line.startsWith('**') && line.endsWith('**')) {
        return <h2 key={i} className="text-lg font-bold text-white mt-6 mb-3">{line.replace(/\*\*/g, '')}</h2>;
      }
      if (line.trim() === '') {
        return <div key={i} className="h-3" />;
      }
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
        <button onClick={() => window.history.back()} className="flex items-center gap-2 text-[#5C5E72] hover:text-white mb-6 text-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          Back
        </button>

        <h1 className="text-2xl font-bold text-white mb-2">Terms & Conditions</h1>
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
            For questions about these Terms, contact us at{' '}
            <a href="mailto:support@wehouse.ng" className="text-[#3B82F6]">support@wehouse.ng</a>
          </p>
        </div>
      </div>
    </div>
  );
}
