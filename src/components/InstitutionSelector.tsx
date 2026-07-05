import { useState, useMemo } from 'react';

// ─── NIGERIAN INSTITUTIONS BY STATE ───────────────────────
// Curated list of major universities, polytechnics & colleges

interface Institution {
  name: string;
  type: 'university' | 'polytechnic' | 'college';
  hasCampuses?: boolean;
}

const INSTITUTIONS_BY_STATE: Record<string, Institution[]> = {
  'Abia': [
    { name: 'Michael Okpara University of Agriculture', type: 'university' },
    { name: 'Abia State University', type: 'university' },
    { name: 'Federal Polytechnic Nekede (Abia campus)', type: 'polytechnic' },
    { name: 'Abia State Polytechnic', type: 'polytechnic' },
    { name: 'College of Education Arochukwu', type: 'college' },
  ],
  'Abuja': [
    { name: 'University of Abuja', type: 'university', hasCampuses: true },
    { name: 'African University of Science and Technology', type: 'university' },
    { name: 'Baze University', type: 'university' },
    { name: 'Nile University of Nigeria', type: 'university' },
    { name: 'Veritas University', type: 'university' },
    { name: 'National Open University of Nigeria', type: 'university' },
    { name: 'Federal Polytechnic Bida (Abuja study centre)', type: 'polytechnic' },
  ],
  'Adamawa': [
    { name: 'American University of Nigeria', type: 'university' },
    { name: 'Modibbo Adama University of Technology', type: 'university', hasCampuses: true },
    { name: 'Adamawa State University', type: 'university' },
    { name: 'Federal Polytechnic Mubi', type: 'polytechnic' },
    { name: 'Adamawa State Polytechnic', type: 'polytechnic' },
  ],
  'Akwa Ibom': [
    { name: 'University of Uyo', type: 'university', hasCampuses: true },
    { name: 'Akwa Ibom State University', type: 'university' },
    { name: 'Obong University', type: 'university' },
    { name: 'Federal Polytechnic Ukana', type: 'polytechnic' },
    { name: 'Akwa Ibom State Polytechnic', type: 'polytechnic' },
  ],
  'Anambra': [
    { name: 'Nnamdi Azikiwe University', type: 'university', hasCampuses: true },
    { name: 'Anambra State University', type: 'university' },
    { name: 'Paul University', type: 'university' },
    { name: 'Federal Polytechnic Oko', type: 'polytechnic' },
    { name: 'Anambra State College of Agriculture', type: 'college' },
  ],
  'Bauchi': [
    { name: 'Abubakar Tafawa Balewa University', type: 'university', hasCampuses: true },
    { name: 'Bauchi State University', type: 'university' },
    { name: 'Federal Polytechnic Bauchi', type: 'polytechnic' },
    { name: 'College of Education Kangere', type: 'college' },
  ],
  'Bayelsa': [
    { name: 'Federal University Otuoke', type: 'university' },
    { name: 'Niger Delta University', type: 'university' },
    { name: 'Federal Polytechnic Ekowe', type: 'polytechnic' },
    { name: 'Bayelsa State College of Arts and Science', type: 'college' },
  ],
  'Benue': [
    { name: 'Benue State University', type: 'university' },
    { name: 'University of Agriculture Makurdi', type: 'university' },
    { name: 'Federal Polytechnic Ugep', type: 'polytechnic' },
    { name: 'College of Education Katsina-Ala', type: 'college' },
  ],
  'Borno': [
    { name: 'University of Maiduguri', type: 'university', hasCampuses: true },
    { name: 'Borno State University', type: 'university' },
    { name: 'Federal Polytechnic Monguno', type: 'polytechnic' },
    { name: 'Mohamet Lawan College of Agriculture', type: 'college' },
  ],
  'Cross River': [
    { name: 'University of Calabar', type: 'university', hasCampuses: true },
    { name: 'Cross River State University of Technology', type: 'university' },
    { name: 'Federal Polytechnic Ukana', type: 'polytechnic' },
    { name: 'College of Education Akamkpa', type: 'college' },
  ],
  'Delta': [
    { name: 'Delta State University', type: 'university', hasCampuses: true },
    { name: 'Federal University of Petroleum Resources', type: 'university' },
    { name: 'Novena University', type: 'university' },
    { name: 'Delta State Polytechnic', type: 'polytechnic', hasCampuses: true },
    { name: 'Petroleum Training Institute', type: 'polytechnic' },
    { name: 'College of Education Warri', type: 'college' },
  ],
  'Ebonyi': [
    { name: 'Ebonyi State University', type: 'university' },
    { name: 'Federal University Ndufu-Alike Ikwo', type: 'university' },
    { name: 'Federal Polytechnic Ohodo', type: 'polytechnic' },
    { name: 'Akanu Ibiam Federal Polytechnic', type: 'polytechnic' },
  ],
  'Edo': [
    { name: 'University of Benin', type: 'university', hasCampuses: true },
    { name: 'Ambrose Alli University', type: 'university' },
    { name: 'Benson Idahosa University', type: 'university' },
    { name: 'Igbinedion University', type: 'university' },
    { name: 'Edo State Polytechnic', type: 'polytechnic' },
    { name: 'Federal Polytechnic Auchi', type: 'polytechnic' },
    { name: 'College of Education Ekiadolor', type: 'college' },
  ],
  'Ekiti': [
    { name: 'Federal University Oye-Ekiti', type: 'university', hasCampuses: true },
    { name: 'Ekiti State University', type: 'university' },
    { name: 'Afe Babalola University', type: 'university' },
    { name: 'Federal Polytechnic Ado-Ekiti', type: 'polytechnic' },
    { name: 'College of Education Ikere-Ekiti', type: 'college' },
  ],
  'Enugu': [
    { name: 'University of Nigeria Nsukka', type: 'university', hasCampuses: true },
    { name: 'Enugu State University of Science and Technology', type: 'university' },
    { name: 'Godfrey Okoye University', type: 'university' },
    { name: 'Caritas University', type: 'university' },
    { name: 'Institute of Management and Technology', type: 'polytechnic' },
    { name: 'Federal Polytechnic Oko (Enugu campus)', type: 'polytechnic' },
    { name: 'Enugu State Polytechnic', type: 'polytechnic' },
  ],
  'Gombe': [
    { name: 'Gombe State University', type: 'university' },
    { name: 'Federal University Kashere', type: 'university' },
    { name: 'Federal Polytechnic Kaltungo', type: 'polytechnic' },
    { name: 'College of Education Billiri', type: 'college' },
  ],
  'Imo': [
    { name: 'Federal University of Technology Owerri', type: 'university' },
    { name: 'Imo State University', type: 'university' },
    { name: 'Eastern Palm University', type: 'university' },
    { name: 'Federal Polytechnic Nekede', type: 'polytechnic' },
    { name: 'Imo State Polytechnic', type: 'polytechnic' },
    { name: 'Alvan Ikoku College of Education', type: 'college' },
  ],
  'Jigawa': [
    { name: 'Federal University Dutse', type: 'university' },
    { name: 'Sule Lamido University', type: 'university' },
    { name: 'Hussaini Adamu Federal Polytechnic', type: 'polytechnic' },
    { name: 'Jigawa State Polytechnic', type: 'polytechnic' },
  ],
  'Kaduna': [
    { name: 'Ahmadu Bello University', type: 'university', hasCampuses: true },
    { name: 'Kaduna State University', type: 'university' },
    { name: 'Nigerian Defence Academy', type: 'university' },
    { name: 'Federal Polytechnic Kaduna', type: 'polytechnic' },
    { name: 'Kaduna Polytechnic', type: 'polytechnic' },
    { name: 'Nuhu Bamalli Polytechnic', type: 'polytechnic' },
    { name: 'Federal College of Education Zaria', type: 'college' },
  ],
  'Kano': [
    { name: 'Bayero University Kano', type: 'university' },
    { name: 'Kano University of Science and Technology', type: 'university' },
    { name: 'Yusuf Maitama Sule University', type: 'university' },
    { name: 'Skyline University Nigeria', type: 'university' },
    { name: 'Federal Polytechnic Kaura Namoda (Kano campus)', type: 'polytechnic' },
    { name: 'Kano State Polytechnic', type: 'polytechnic' },
    { name: 'Aminu Kano College of Islamic and Legal Studies', type: 'college' },
  ],
  'Katsina': [
    { name: 'Umaru Musa Yar\'adua University', type: 'university' },
    { name: 'Federal University Dutsin-Ma', type: 'university' },
    { name: 'Hassan Usman Katsina Polytechnic', type: 'polytechnic' },
    { name: 'Federal College of Education Katsina', type: 'college' },
  ],
  'Kebbi': [
    { name: 'Kebbi State University of Science and Technology', type: 'university' },
    { name: 'Federal University Birnin Kebbi', type: 'university' },
    { name: 'Kebbi State Polytechnic', type: 'polytechnic' },
    { name: 'College of Agriculture Zuru', type: 'college' },
  ],
  'Kogi': [
    { name: 'Federal University Lokoja', type: 'university' },
    { name: 'Kogi State University', type: 'university' },
    { name: 'Federal Polytechnic Idah', type: 'polytechnic' },
    { name: 'Kogi State Polytechnic', type: 'polytechnic' },
    { name: 'College of Education Ankpa', type: 'college' },
  ],
  'Kwara': [
    { name: 'University of Ilorin', type: 'university' },
    { name: 'Kwara State University', type: 'university' },
    { name: 'Al-Hikmah University', type: 'university' },
    { name: 'Landmark University', type: 'university' },
    { name: 'Federal Polytechnic Offa', type: 'polytechnic' },
    { name: 'Kwara State Polytechnic', type: 'polytechnic' },
    { name: 'School of Nursing Ilorin', type: 'college' },
  ],
  'Lagos': [
    { name: 'University of Lagos', type: 'university', hasCampuses: true },
    { name: 'Lagos State University', type: 'university', hasCampuses: true },
    { name: 'Pan-Atlantic University', type: 'university' },
    { name: 'Caleb University', type: 'university' },
    { name: 'Anchor University', type: 'university' },
    { name: 'Augustine University', type: 'university' },
    { name: 'Chrisland University', type: 'university' },
    { name: 'Yaba College of Technology', type: 'polytechnic' },
    { name: 'Lagos State Polytechnic', type: 'polytechnic' },
    { name: 'Federal College of Education Akoka', type: 'college' },
    { name: 'Adeniran Ogunsanya College of Education', type: 'college' },
    { name: 'Michael Otedola College of Primary Education', type: 'college' },
    { name: 'National Open University of Nigeria (Lagos)', type: 'university' },
  ],
  'Nasarawa': [
    { name: 'Federal University Lafia', type: 'university' },
    { name: 'Nasarawa State University', type: 'university' },
    { name: 'Federal Polytechnic Nasarawa', type: 'polytechnic' },
    { name: 'College of Education Akwanga', type: 'college' },
  ],
  'Niger': [
    { name: 'Federal University of Technology Minna', type: 'university' },
    { name: 'Ibrahim Badamasi Babangida University', type: 'university' },
    { name: 'Federal Polytechnic Bida', type: 'polytechnic' },
    { name: 'Niger State Polytechnic', type: 'polytechnic' },
    { name: 'College of Education Minna', type: 'college' },
  ],
  'Ogun': [
    { name: 'Covenant University', type: 'university' },
    { name: 'Olabisi Onabanjo University', type: 'university', hasCampuses: true },
    { name: 'Federal University of Agriculture Abeokuta', type: 'university' },
    { name: 'Babcock University', type: 'university' },
    { name: 'Tai Solarin University of Education', type: 'university' },
    { name: 'Moshood Abiola Polytechnic', type: 'polytechnic' },
    { name: 'Federal Polytechnic Ilaro', type: 'polytechnic' },
    { name: 'Gateway Polytechnic', type: 'polytechnic' },
    { name: 'Abraham Adesanya Polytechnic', type: 'polytechnic' },
    { name: 'Ogun State College of Health Technology', type: 'college' },
  ],
  'Ondo': [
    { name: 'Federal University of Technology Akure', type: 'university' },
    { name: 'Adekunle Ajasin University', type: 'university' },
    { name: 'Ondo State University of Science and Technology', type: 'university' },
    { name: 'Elizade University', type: 'university' },
    { name: 'Adeyemi College of Education', type: 'college' },
    { name: 'Federal Polytechnic Ile-Oluji', type: 'polytechnic' },
    { name: 'Rufus Giwa Polytechnic', type: 'polytechnic' },
  ],
  'Osun': [
    { name: 'Obafemi Awolowo University', type: 'university' },
    { name: 'Osun State University', type: 'university', hasCampuses: true },
    { name: 'Bowen University', type: 'university' },
    { name: 'Redeemer\'s University', type: 'university' },
    { name: 'Federal Polytechnic Ede', type: 'polytechnic' },
    { name: 'Osun State Polytechnic', type: 'polytechnic' },
    { name: 'Federal College of Education Ila-Orangun', type: 'college' },
  ],
  'Oyo': [
    { name: 'University of Ibadan', type: 'university' },
    { name: 'Lead City University', type: 'university' },
    { name: 'Dominion University', type: 'university' },
    { name: 'The Polytechnic Ibadan', type: 'polytechnic' },
    { name: 'Oyo State College of Agriculture', type: 'college' },
    { name: 'Federal College of Education Special Oyo', type: 'college' },
    { name: 'Federal College of Forestry', type: 'college' },
  ],
  'Plateau': [
    { name: 'University of Jos', type: 'university', hasCampuses: true },
    { name: 'Plateau State University', type: 'university' },
    { name: 'Federal Polytechnic Barkin Ladi', type: 'polytechnic' },
    { name: 'Plateau State Polytechnic', type: 'polytechnic' },
    { name: 'College of Agriculture Garkawa', type: 'college' },
  ],
  'Rivers': [
    { name: 'University of Port Harcourt', type: 'university' },
    { name: 'Rivers State University', type: 'university' },
    { name: 'Federal University of Technology Owerri (Rivers campus)', type: 'university' },
    { name: 'Ignatius Ajuru University of Education', type: 'university' },
    { name: 'Kenule Beeson Saro-Wiwa Polytechnic', type: 'polytechnic' },
    { name: 'Captain Elechi Amadi Polytechnic', type: 'polytechnic' },
    { name: 'Port Harcourt Polytechnic', type: 'polytechnic' },
    { name: 'Federal College of Education Technical Omoku', type: 'college' },
    { name: 'Eastern Polytechnic', type: 'polytechnic' },
  ],
  'Sokoto': [
    { name: 'Usmanu Danfodiyo University', type: 'university' },
    { name: 'Sokoto State University', type: 'university' },
    { name: 'Shehu Shagari College of Education', type: 'college' },
    { name: 'Sokoto Polytechnic', type: 'polytechnic' },
  ],
  'Taraba': [
    { name: 'Taraba State University', type: 'university' },
    { name: 'Federal University Wukari', type: 'university' },
    { name: 'College of Agriculture Jalingo', type: 'college' },
    { name: 'Taraba State Polytechnic', type: 'polytechnic' },
  ],
  'Yobe': [
    { name: 'Yobe State University', type: 'university' },
    { name: 'Federal University Gashua', type: 'university' },
    { name: 'Federal Polytechnic Damaturu', type: 'polytechnic' },
    { name: 'College of Education Gashua', type: 'college' },
  ],
  'Zamfara': [
    { name: 'Federal University Gusau', type: 'university' },
    { name: 'Zamfara State University', type: 'university' },
    { name: 'Federal Polytechnic Kaura-Namoda', type: 'polytechnic' },
    { name: 'College of Education Maru', type: 'college' },
  ],
};

const LEVELS = ['100', '200', '300', '400', '500', '600', 'PG'];

// Type icons
const TYPE_ICONS: Record<string, string> = {
  university: '🎓',
  polytechnic: '🔧',
  college: '📚',
};

interface InstitutionSelectorProps {
  value: {
    school_name: string;
    campus: string;
    faculty: string;
    level: string;
  };
  onChange: (v: {
    school_name: string;
    campus: string;
    faculty: string;
    level: string;
  }) => void;
}

export default function InstitutionSelector({ value, onChange }: InstitutionSelectorProps) {
  const [selectedState, setSelectedState] = useState('');

  // Get states that have institutions, sorted
  const states = useMemo(() => {
    return Object.keys(INSTITUTIONS_BY_STATE).sort();
  }, []);

  // Get institutions for selected state
  const institutions = useMemo(() => {
    if (!selectedState) return [];
    return INSTITUTIONS_BY_STATE[selectedState] || [];
  }, [selectedState]);

  // Get campuses for selected institution
  const campuses = useMemo(() => {
    if (!value.school_name) return [];
    // Check if the selected institution has campuses
    const inst = institutions.find(i => i.name === value.school_name);
    if (!inst?.hasCampuses) return [];
    // Return common campus names
    return ['Main Campus', 'Satellite Campus', 'College Campus'];
  }, [value.school_name, institutions]);

  const update = (key: string, val: string) => {
    // When changing school, reset campus
    if (key === 'school_name') {
      onChange({ ...value, [key]: val, campus: '' });
    } else {
      onChange({ ...value, [key]: val });
    }
  };

  // When user picks a state but hasn't picked an institution yet
  const handleStateChange = (state: string) => {
    setSelectedState(state);
    // Don't reset school — let user pick from the filtered list
  };

  return (
    <div className="space-y-3">
      {/* State Selection */}
      <div>
        <label className="text-[10px] text-[#5C5E72] mb-1.5 block">State where you study</label>
        <select
          value={selectedState}
          onChange={(e) => handleStateChange(e.target.value)}
          className="w-full h-11 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-sm px-4 focus:border-[#3B82F6]/50 outline-none appearance-none cursor-pointer"
        >
          <option value="">Select state...</option>
          {states.map(state => (
            <option key={state} value={state}>{state}</option>
          ))}
        </select>
      </div>

      {/* Institution Selection — filtered by state */}
      {selectedState && (
        <div className="animate-fadeIn">
          <label className="text-[10px] text-[#5C5E72] mb-1.5 block">
            Institution ({institutions.length} in {selectedState})
          </label>
          <div className="max-h-[200px] overflow-y-auto space-y-1.5 pr-1 scrollbar-thin">
            {institutions.map((inst) => (
              <button
                key={inst.name}
                type="button"
                onClick={() => update('school_name', inst.name)}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs transition-all flex items-center gap-2.5 ${
                  value.school_name === inst.name
                    ? 'bg-[#3B82F6]/15 border border-[#3B82F6]/30 text-white'
                    : 'bg-[#1A1A24]/60 border border-transparent text-[#8A8B9C] hover:bg-[#1A1A24] hover:text-white'
                }`}
              >
                <span className="text-base flex-shrink-0">{TYPE_ICONS[inst.type]}</span>
                <div className="min-w-0">
                  <p className="font-medium truncate">{inst.name}</p>
                  <p className="text-[9px] opacity-60 capitalize">{inst.type}</p>
                </div>
                {value.school_name === inst.name && (
                  <svg className="ml-auto flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Campus Selection (if applicable) */}
      {value.school_name && campuses.length > 0 && (
        <div className="animate-fadeIn">
          <label className="text-[10px] text-[#5C5E72] mb-1.5 block">Campus</label>
          <div className="flex gap-2 flex-wrap">
            {campuses.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => update('campus', c)}
                className={`h-8 px-3 rounded-lg text-[11px] font-medium transition-all ${
                  value.campus === c
                    ? 'bg-[#3B82F6] text-white'
                    : 'bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Faculty (optional) */}
      {value.school_name && (
        <div className="animate-fadeIn">
          <label className="text-[10px] text-[#5C5E72] mb-1 block">Faculty / Department (optional)</label>
          <input
            value={value.faculty}
            onChange={(e) => update('faculty', e.target.value)}
            placeholder="e.g. Engineering, Computer Science..."
            className="w-full h-10 rounded-xl bg-[#1A1A24] border border-[#2A2A3A] text-white text-xs px-3 placeholder-[#5C5E72] focus:border-[#3B82F6]/50 outline-none"
          />
        </div>
      )}

      {/* Level */}
      {value.school_name && (
        <div className="animate-fadeIn">
          <label className="text-[10px] text-[#5C5E72] mb-1.5 block">Level</label>
          <div className="flex gap-2 flex-wrap">
            {LEVELS.map(l => (
              <button
                key={l}
                type="button"
                onClick={() => update('level', l)}
                className={`h-8 px-3.5 rounded-lg text-[11px] font-medium transition-all ${
                  value.level === l
                    ? 'bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white shadow-lg shadow-blue-500/20'
                    : 'bg-[#1A1A24] border border-[#2A2A3A] text-[#8A8B9C] hover:border-[#3B82F6]/30'
                }`}
              >
                {l}L
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CSS ANIMATION ────────────────────────────────────────
// Add to your CSS: .animate-fadeIn { animation: fadeIn 0.2s ease-out; }
// @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
