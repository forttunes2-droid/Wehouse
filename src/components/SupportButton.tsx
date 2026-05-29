import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface SupportConfig {
  whatsapp: string;
  telegram: string;
  email: string;
}

export default function SupportButton() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<SupportConfig>({ whatsapp: '', telegram: '', email: '' });
  const [hasConfig, setHasConfig] = useState(false);

  useEffect(() => {
    async function load() {
      const keys = ['support_whatsapp', 'support_telegram', 'support_email'];
      const { data } = await supabase.from('platform_settings').select('key, value').in('key', keys);
      const map: Record<string, string> = {};
      (data || []).forEach((r: any) => { if (r.value) map[r.key] = r.value; });
      const cfg: SupportConfig = {
        whatsapp: map['support_whatsapp'] || '',
        telegram: map['support_telegram'] || '',
        email: map['support_email'] || '',
      };
      setConfig(cfg);
      setHasConfig(!!cfg.whatsapp || !!cfg.telegram || !!cfg.email);
    }
    load();
  }, []);

  if (!hasConfig) return null;

  return (
    <>
      {/* Floating Support Button */}
      <button
        onClick={() => setOpen(!open)}
        className={`fixed bottom-20 right-5 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 ${
          open
            ? 'bg-[#1A1A24] border border-white/[0.1] rotate-45'
            : 'bg-gradient-to-r from-[#3B82F6] to-[#7C3AED] hover:scale-105 active:scale-95'
        }`}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        )}
      </button>

      {/* Support Menu */}
      {open && (
        <div className="fixed bottom-[140px] right-5 z-50 w-[260px] bg-[#12121A] border border-white/[0.06] rounded-2xl shadow-2xl overflow-hidden animate-slideUp">
          {/* Header */}
          <div className="px-4 py-3 border-b border-white/[0.04]">
            <p className="text-sm font-semibold text-white">WeHouse Support</p>
            <p className="text-[10px] text-[#5C5E72]">How can we help you?</p>
          </div>

          {/* Contact Options */}
          <div className="p-2 space-y-1">
            {/* WhatsApp */}
            {config.whatsapp && (
              <a
                href={`https://wa.me/${config.whatsapp.replace(/^\+/, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.03] transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#34D399"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
                </div>
                <div>
                  <p className="text-xs font-medium text-white">WhatsApp</p>
                  <p className="text-[10px] text-[#5C5E72]">Chat with us</p>
                </div>
              </a>
            )}

            {/* Telegram */}
            {config.telegram && (
              <a
                href={config.telegram.startsWith('http') ? config.telegram : `https://t.me/${config.telegram.replace(/^@/, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.03] transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#3B82F6"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>
                </div>
                <div>
                  <p className="text-xs font-medium text-white">Telegram</p>
                  <p className="text-[10px] text-[#5C5E72]">Message us</p>
                </div>
              </a>
            )}

            {/* Email */}
            {config.email && (
              <a
                href={`mailto:${config.email}`}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.03] transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white">Email</p>
                  <p className="text-[10px] text-[#5C5E72] truncate">{config.email}</p>
                </div>
              </a>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-white/[0.04] text-center">
            <p className="text-[9px] text-[#5C5E72]">Available 24/7</p>
          </div>
        </div>
      )}

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .animate-slideUp { animation: slideUp 0.2s ease-out; }
      `}</style>
    </>
  );
}
