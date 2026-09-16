from pathlib import Path

path = Path('src/pages/Login.tsx')
source = path.read_text()

old_open = '''  return (\n    <div className="flex min-h-screen items-center justify-center bg-transparent px-5 text-white">\n      <div className="w-full max-w-[380px]">\n        <Brand compact={mode !== "choose" && mode !== "signin" && mode !== "signup"} />'''
new_open = '''  return (\n    <div className="relative min-h-[100dvh] overflow-hidden bg-[#07070A] text-white">\n      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">\n        <div className="absolute -left-28 -top-20 h-80 w-80 rounded-full bg-violet-600/20 blur-[110px]" />\n        <div className="absolute -bottom-32 right-[-5rem] h-[28rem] w-[28rem] rounded-full bg-fuchsia-700/10 blur-[140px]" />\n        <div className="absolute inset-0 opacity-[.12]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)", backgroundSize: "46px 46px", maskImage: "linear-gradient(to bottom, black, transparent 78%)" }} />\n      </div>\n      <div className="relative mx-auto grid min-h-[100dvh] w-full max-w-[1500px] lg:grid-cols-[1.08fr_.92fr]">\n        <AuthStory />\n        <main className="flex items-center justify-center px-4 py-6 sm:px-8 lg:px-12 lg:py-10">\n          <section className="w-full max-w-[470px] overflow-hidden rounded-[30px] border border-white/[.08] bg-[#0E1017]/92 shadow-[0_30px_90px_rgba(0,0,0,.45)] backdrop-blur-2xl">\n            <div className="border-b border-white/[.05] px-5 py-5 sm:px-8">\n              <div className="flex items-center justify-between gap-4">\n                <span className="text-[9px] font-bold uppercase tracking-[.22em] text-violet-300">Secure WeHouse access</span>\n                <span className="inline-flex items-center gap-1.5 text-[9px] text-[#7C8292]"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />One identity</span>\n              </div>\n            </div>\n            <div className="px-5 py-6 sm:px-8 sm:py-8">\n              <Brand compact={mode !== "choose" && mode !== "signin" && mode !== "signup"} />'''
if old_open not in source:
    raise SystemExit('login outer shell opening not found')
source = source.replace(old_open, new_open, 1)

old_close = '''        {mode === "recover" ? (\n          <form onSubmit={(event) => void handleRecovery(event)} className="space-y-4">'''
if old_close not in source:
    raise SystemExit('recover marker not found')
# no change here; marker only proves we are patching the expected source

old_end = '''        ) : null}\n      </div>\n    </div>\n  );\n}\n\nfunction Brand'''
new_end = '''        ) : null}\n            </div>\n            <div className="border-t border-white/[.05] px-5 py-4 sm:px-8">\n              <div className="flex items-center justify-between gap-3 text-[8px] text-[#626979]">\n                <span>find · connect · live better</span>\n                <span>wehouse.com.ng</span>\n              </div>\n            </div>\n          </section>\n        </main>\n      </div>\n    </div>\n  );\n}\n\nfunction AuthStory() {\n  return (\n    <aside className="relative hidden min-h-[100dvh] overflow-hidden border-r border-white/[.05] lg:flex lg:items-center lg:px-14 xl:px-20">\n      <div className="relative z-10 max-w-[620px]">\n        <img src="/brand-lockup-dark.svg?v=2" alt="WeHouse" className="h-auto w-56" />\n        <p className="mt-10 text-[10px] font-bold uppercase tracking-[.28em] text-violet-300">Find · connect · live better</p>\n        <h1 className="mt-5 max-w-[590px] text-[clamp(2.8rem,4.8vw,5.4rem)] font-black leading-[.93] tracking-[-.055em] text-white">\n          Your place, your people, your work — one account.\n        </h1>\n        <p className="mt-6 max-w-xl text-[15px] leading-7 text-[#969CAB]">\n          Discover homes and hotels, meet compatible roommates, book trusted services and manage every real WeHouse journey without creating separate identities.\n        </p>\n        <div className="mt-10 grid grid-cols-3 gap-3">\n          <AuthFeature index="01" title="Find a place" detail="Homes, Short Let and hotels" />\n          <AuthFeature index="02" title="Connect safely" detail="Roommates and private conversations" />\n          <AuthFeature index="03" title="Get things done" detail="Services and protected bookings" />\n        </div>\n        <div className="mt-8 flex items-center gap-3 text-[10px] text-[#747B8B]">\n          <span className="h-px w-10 bg-violet-400/50" />\n          <span>Built around real housing journeys, not disconnected dashboards.</span>\n        </div>\n      </div>\n      <div aria-hidden="true" className="absolute bottom-[-12rem] left-[18%] h-[32rem] w-[32rem] rounded-full border border-violet-400/10" />\n      <div aria-hidden="true" className="absolute bottom-[-8rem] left-[25%] h-[22rem] w-[22rem] rounded-full border border-violet-400/10" />\n    </aside>\n  );\n}\n\nfunction AuthFeature({ index, title, detail }: { index: string; title: string; detail: string }) {\n  return (\n    <div className="min-h-32 rounded-2xl border border-white/[.07] bg-white/[.025] p-4 backdrop-blur-sm">\n      <p className="text-[8px] font-bold tracking-[.18em] text-violet-300">{index}</p>\n      <p className="mt-6 text-[12px] font-semibold text-white">{title}</p>\n      <p className="mt-1 text-[9px] leading-4 text-[#707787]">{detail}</p>\n    </div>\n  );\n}\n\nfunction Brand'''
if old_end not in source:
    raise SystemExit('login outer shell closing not found')
source = source.replace(old_end, new_end, 1)

old_choose = '''        {mode === "choose" ? (\n          <div className="space-y-3">'''
new_choose = '''        {mode === "choose" ? (\n          <div className="space-y-3">\n            <div className="pb-3 text-center lg:text-left">\n              <p className="text-[9px] font-bold uppercase tracking-[.2em] text-violet-300">One Personal account</p>\n              <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-[-.035em] text-white sm:text-[30px]">Everything starts here.</h1>\n              <p className="mx-auto mt-2 max-w-sm text-[11px] leading-5 text-[#858B9A] lg:mx-0">Homes, hotels, roommates and WeHouse Services stay connected to one identity.</p>\n            </div>'''
if old_choose not in source:
    raise SystemExit('choose block not found')
source = source.replace(old_choose, new_choose, 1)

replacements = {
'''className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-[#0A0A0F] disabled:opacity-50"''': '''className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-semibold text-[#0A0A0F] shadow-[0_8px_30px_rgba(255,255,255,.08)] transition hover:-translate-y-0.5 hover:bg-[#F7F7FA] disabled:translate-y-0 disabled:opacity-50"''',
'''className="h-12 w-full rounded-xl border border-white/[.08] bg-[#171A23] text-sm font-medium"''': '''className="h-12 w-full rounded-2xl border border-white/[.09] bg-white/[.035] text-sm font-medium text-[#E6E8EE] transition hover:border-violet-400/25 hover:bg-violet-500/[.06]"''',
'''className="h-12 w-full rounded-xl bg-violet-500 text-sm font-semibold"''': '''className="h-12 w-full rounded-2xl bg-violet-500 text-sm font-semibold shadow-[0_12px_34px_rgba(139,92,246,.25)] transition hover:-translate-y-0.5 hover:bg-violet-400"''',
'''className="h-12 rounded-xl border-white/[.08] bg-[#171A23] text-white"''': '''className="h-12 rounded-2xl border-white/[.08] bg-white/[.035] text-white shadow-inner shadow-black/10 focus-visible:border-violet-400/50 focus-visible:ring-violet-500/20"''',
'''className="h-12 rounded-xl border-white/[.08] bg-[#171A23] pr-12 text-white"''': '''className="h-12 rounded-2xl border-white/[.08] bg-white/[.035] pr-12 text-white shadow-inner shadow-black/10 focus-visible:border-violet-400/50 focus-visible:ring-violet-500/20"''',
}
for old, new in replacements.items():
    source = source.replace(old, new)

old_brand = '''function Brand({ compact = false }: { compact?: boolean }) {\n  return (\n    <div className={compact ? "mb-5 text-center" : "mb-7 text-center"}>\n      <img\n        src="/brand-lockup-dark.svg?v=2"\n        alt="WeHouse — Find. Connect. Live better."\n        className={`mx-auto h-auto max-w-full ${compact ? "w-40" : "w-64"}`}\n      />\n    </div>\n  );\n}'''
new_brand = '''function Brand({ compact = false }: { compact?: boolean }) {\n  return (\n    <div className={`${compact ? "mb-5" : "mb-6"} text-center lg:text-left`}>\n      <img\n        src="/brand-lockup-dark.svg?v=2"\n        alt="WeHouse — Find. Connect. Live better."\n        className={`h-auto max-w-full ${compact ? "mx-auto w-36 lg:mx-0" : "mx-auto w-48 lg:mx-0 lg:w-44"}`}\n      />\n    </div>\n  );\n}'''
if old_brand not in source:
    raise SystemExit('brand helper not found')
source = source.replace(old_brand, new_brand, 1)

path.write_text(source)
print('login experience shell patched')
