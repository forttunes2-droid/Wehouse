// ═══════════════════════════════════════════════════════════════
// NIGERIA STATES & LOCAL GOVERNMENT AREAS (LGA)
// Complete data for all 36 states + Federal Capital Territory
// ═══════════════════════════════════════════════════════════════

export interface StateData {
  name: string;
  code: string; // Short code e.g. "LA" for Lagos
  capital: string;
  lgAs: string[];
}

export const NIGERIA_STATES: StateData[] = [
  {
    name: "Abia",
    code: "AB",
    capital: "Umuahia",
    lgAs: ["Aba North", "Aba South", "Arochukwu", "Bende", "Ikwuano", "Isiala Ngwa North", "Isiala Ngwa South", "Isuikwuato", "Obi Ngwa", "Ohafia", "Osisioma", "Ugwunagbo", "Ukwa East", "Ukwa West", "Umuahia North", "Umuahia South", "Umu Nneochi"]
  },
  {
    name: "Adamawa",
    code: "AD",
    capital: "Yola",
    lgAs: ["Demsa", "Fufure", "Ganye", "Gayuk", "Gombi", "Grie", "Hong", "Jada", "Lamurde", "Madagali", "Maiha", "Mayo Belwa", "Michika", "Mubi North", "Mubi South", "Numan", "Shelleng", "Song", "Toungo", "Yola North", "Yola South"]
  },
  {
    name: "Akwa Ibom",
    code: "AK",
    capital: "Uyo",
    lgAs: ["Abak", "Eastern Obolo", "Eket", "Esit Eket", "Essien Udim", "Etim Ekpo", "Etinan", "Ibeno", "Ibesikpo Asutan", "Ibiono Ibom", "Ika", "Ikono", "Ikot Abasi", "Ikot Ekpene", "Ini", "Itu", "Mbo", "Mkpat Enin", "Nsit Atai", "Nsit Ibom", "Nsit Ubium", "Obot Akara", "Okobo", "Onna", "Oron", "Oruk Anam", "Udung Uko", "Ukanafun", "Uruan", "Urue Offong Oruko", "Uyo"]
  },
  {
    name: "Anambra",
    code: "AN",
    capital: "Awka",
    lgAs: ["Aguata", "Anambra East", "Anambra West", "Anaocha", "Awka North", "Awka South", "Ayamelum", "Dunukofia", "Ekwusigo", "Idemili North", "Idemili South", "Ihiala", "Njikoka", "Nnewi North", "Nnewi South", "Ogbaru", "Onitsha North", "Onitsha South", "Orumba North", "Orumba South", "Oyi"]
  },
  {
    name: "Bauchi",
    code: "BA",
    capital: "Bauchi",
    lgAs: ["Alkaleri", "Bauchi", "Bogoro", "Damban", "Darazo", "Dass", "Gamawa", "Ganjuwa", "Giade", "Itas Gadau", "Jamaare", "Katagum", "Kirfi", "Misau", "Ningi", "Shira", "Tafawa Balewa", "Toro", "Warji", "Zaki"]
  },
  {
    name: "Bayelsa",
    code: "BY",
    capital: "Yenagoa",
    lgAs: ["Brass", "Ekeremor", "Kolokuma Opokuma", "Nembe", "Ogbia", "Sagbama", "Southern Ijaw", "Yenagoa"]
  },
  {
    name: "Benue",
    code: "BE",
    capital: "Makurdi",
    lgAs: ["Ado", "Agatu", "Apa", "Buruku", "Gboko", "Guma", "Gwer East", "Gwer West", "Katsina-Ala", "Konshisha", "Kwande", "Logo", "Makurdi", "Obi", "Ogbadibo", "Ohimini", "Oju", "Okpokwu", "Otukpo", "Tarka", "Ukum", "Ushongo", "Vandeikya"]
  },
  {
    name: "Borno",
    code: "BO",
    capital: "Maiduguri",
    lgAs: ["Abadam", "Askira Uba", "Bama", "Bayo", "Biu", "Chibok", "Damboa", "Dikwa", "Gubio", "Guzamala", "Gwoza", "Hawul", "Jere", "Kaga", "Kala Balge", "Konduga", "Kukawa", "Kwaya Kusar", "Mafa", "Magumeri", "Maiduguri", "Marte", "Mobbar", "Monguno", "Ngala", "Nganzai", "Shani"]
  },
  {
    name: "Cross River",
    code: "CR",
    capital: "Calabar",
    lgAs: ["Abi", "Akamkpa", "Akpabuyo", "Bakassi", "Bekwarra", "Biase", "Boki", "Calabar Municipal", "Calabar South", "Etung", "Ikom", "Obanliku", "Obubra", "Obudu", "Odukpani", "Ogoja", "Yakurr", "Yala"]
  },
  {
    name: "Delta",
    code: "DE",
    capital: "Asaba",
    lgAs: ["Aniocha North", "Aniocha South", "Bomadi", "Burutu", "Ethiope East", "Ethiope West", "Ika North East", "Ika South", "Isoko North", "Isoko South", "Ndokwa East", "Ndokwa West", "Okpe", "Oshimili North", "Oshimili South", "Patani", "Sapele", "Udu", "Ughelli North", "Ughelli South", "Ukwuani", "Uvwie", "Warri North", "Warri South", "Warri South West"]
  },
  {
    name: "Ebonyi",
    code: "EB",
    capital: "Abakaliki",
    lgAs: ["Abakaliki", "Afikpo North", "Afikpo South", "Ebonyi", "Ezza North", "Ezza South", "Ikwo", "Ishielu", "Ivo", "Izzi", "Ohaukwu", "Onicha"]
  },
  {
    name: "Edo",
    code: "ED",
    capital: "Benin City",
    lgAs: ["Akoko-Edo", "Egor", "Esan Central", "Esan North-East", "Esan South-East", "Esan West", "Etsako Central", "Etsako East", "Etsako West", "Igueben", "Ikpoba Okha", "Orhionmwon", "Oredo", "Ovia North-East", "Ovia South-West", "Owan East", "Owan West", "Uhunmwonde"]
  },
  {
    name: "Ekiti",
    code: "EK",
    capital: "Ado Ekiti",
    lgAs: ["Ado Ekiti", "Efon", "Ekiti East", "Ekiti South-West", "Ekiti West", "Emure", "Gbonyin", "Ido Osi", "Ijero", "Ikere", "Ikole", "Ilejemeje", "Irepodun Ifelodun", "Ise Orun", "Moba", "Oye"]
  },
  {
    name: "Enugu",
    code: "EN",
    capital: "Enugu",
    lgAs: ["Aninri", "Awgu", "Enugu East", "Enugu North", "Enugu South", "Ezeagu", "Igbo Etiti", "Igbo Eze North", "Igbo Eze South", "Isi Uzo", "Nkanu East", "Nkanu West", "Nsukka", "Oji River", "Udenu", "Udi", "Uzo Uwani"]
  },
  {
    name: "Federal Capital Territory",
    code: "FC",
    capital: "Abuja",
    lgAs: ["Abaji", "Bwari", "Gwagwalada", "Kuje", "Kwali", "Municipal Area Council (AMAC)"]
  },
  {
    name: "Gombe",
    code: "GO",
    capital: "Gombe",
    lgAs: ["Akko", "Balanga", "Billiri", "Dukku", "Funakaye", "Gombe", "Kaltungo", "Kwami", "Nafada", "Shongom", "Yamaltu Deba"]
  },
  {
    name: "Imo",
    code: "IM",
    capital: "Owerri",
    lgAs: ["Aboh Mbaise", "Ahiazu Mbaise", "Ehime Mbano", "Ezinihitte", "Ideato North", "Ideato South", "Ihitte Uboma", "Ikeduru", "Isiala Mbano", "Isu", "Mbaitoli", "Ngor Okpala", "Njaba", "Nkwerre", "Nwangele", "Obowo", "Oguta", "Ohaji Egbema", "Okigwe", "Orlu", "Orsu", "Oru East", "Oru West", "Owerri Municipal", "Owerri North", "Owerri West", "Unuimo"]
  },
  {
    name: "Jigawa",
    code: "JI",
    capital: "Dutse",
    lgAs: ["Auyo", "Babura", "Biriniwa", "Birnin Kudu", "Buji", "Dutse", "Gagarawa", "Garki", "Gumel", "Guri", "Gwaram", "Gwiwa", "Hadejia", "Jahun", "Kafin Hausa", "Kaugama", "Kazaure", "Kiri Kasama", "Kiyawa", "Maigatari", "Malam Madori", "Miga", "Ringim", "Roni", "Sule Tankarkar", "Taura", "Yankwashi"]
  },
  {
    name: "Kaduna",
    code: "KD",
    capital: "Kaduna",
    lgAs: ["Birnin Gwari", "Chikun", "Giwa", "Igabi", "Ikara", "Jaba", "Jema'a", "Kachia", "Kaduna North", "Kaduna South", "Kagarko", "Kajuru", "Kaura", "Kauru", "Kubau", "Kudan", "Lere", "Makarfi", "Sabon Gari", "Sanga", "Soba", "Zangon Kataf", "Zaria"]
  },
  {
    name: "Kano",
    code: "KN",
    capital: "Kano",
    lgAs: ["Ajingi", "Albasu", "Bagwai", "Bebeji", "Bichi", "Bunkure", "Dala", "Dambatta", "Dawakin Kudu", "Dawakin Tofa", "Doguwa", "Fagge", "Gabasawa", "Garko", "Garun Mallam", "Gaya", "Gezawa", "Gwale", "Gwarzo", "Kabo", "Kano Municipal", "Karaye", "Kibiya", "Kiru", "Kumbotso", "Kunchi", "Kura", "Madobi", "Makoda", "Minjibir", "Nasarawa", "Rano", "Rimin Gado", "Rogo", "Shanono", "Sumaila", "Takai", "Tarauni", "Tofa", "Tsanyawa", "Tudun Wada", "Ungogo", "Warawa", "Wudil"]
  },
  {
    name: "Katsina",
    code: "KT",
    capital: "Katsina",
    lgAs: ["Bakori", "Batagarawa", "Batsari", "Baure", "Bindawa", "Charanchi", "Dandume", "Danja", "Dan Musa", "Daura", "Dutsi", "Dutsin Ma", "Faskari", "Funtua", "Ingawa", "Jibia", "Kafur", "Kaita", "Kankara", "Kankia", "Katsina", "Kurfi", "Kusada", "Mai'Adua", "Malumfashi", "Mani", "Mashi", "Matazu", "Musawa", "Rimi", "Sabuwa", "Safana", "Sandamu", "Zango"]
  },
  {
    name: "Kebbi",
    code: "KE",
    capital: "Birnin Kebbi",
    lgAs: ["Aleiro", "Arewa Dandi", "Argungu", "Augie", "Bagudo", "Birnin Kebbi", "Bunza", "Dandi", "Fakai", "Gwandu", "Jega", "Kalgo", "Koko Besse", "Maiyama", "Ngaski", "Sakaba", "Shanga", "Suru", "Wasagu Danko", "Yauri", "Zuru"]
  },
  {
    name: "Kogi",
    code: "KO",
    capital: "Lokoja",
    lgAs: ["Adavi", "Ajaokuta", "Ankpa", "Bassa", "Dekina", "Ibaji", "Idah", "Igalamela Odolu", "Ijumu", "Kabba Bunu", "Kogi", "Lokoja", "Mopa Muro", "Ofu", "Ogori Magongo", "Okehi", "Okene", "Olamaboro", "Omala", "Yagba East", "Yagba West"]
  },
  {
    name: "Kwara",
    code: "KW",
    capital: "Ilorin",
    lgAs: ["Asa", "Baruten", "Edu", "Ekiti (Kwara)", "Ifelodun", "Ilorin East", "Ilorin South", "Ilorin West", "Irepodun", "Isin", "Kaiama", "Moro", "Offa", "Oke Ero", "Oyun", "Pategi"]
  },
  {
    name: "Lagos",
    code: "LA",
    capital: "Ikeja",
    lgAs: ["Agege", "Ajeromi-Ifelodun", "Alimosho", "Amuwo-Odofin", "Apapa", "Badagry", "Epe", "Eti Osa", "Ibeju-Lekki", "Ifako-Ijaiye", "Ikeja", "Ikorodu", "Kosofe", "Lagos Island", "Lagos Mainland", "Mushin", "Ojo", "Oshodi-Isolo", "Shomolu", "Surulere"]
  },
  {
    name: "Nasarawa",
    code: "NA",
    capital: "Lafia",
    lgAs: ["Akwanga", "Awe", "Doma", "Karu", "Keana", "Keffi", "Kokona", "Lafia", "Nasarawa", "Nasarawa Egon", "Obi", "Toto", "Wamba"]
  },
  {
    name: "Niger",
    code: "NI",
    capital: "Minna",
    lgAs: ["Agaie", "Agwara", "Bida", "Borgu", "Bosso", "Chanchaga", "Edati", "Gbako", "Gurara", "Katcha", "Kontagora", "Lapai", "Lavun", "Magama", "Mariga", "Mashegu", "Mokwa", "Moya", "Paikoro", "Rafi", "Rijau", "Shiroro", "Suleja", "Tafa", "Wushishi"]
  },
  {
    name: "Ogun",
    code: "OG",
    capital: "Abeokuta",
    lgAs: ["Abeokuta North", "Abeokuta South", "Ado-Odo Ota", "Egbado North", "Egbado South", "Ewekoro", "Ifo", "Ijebu East", "Ijebu North", "Ijebu North East", "Ijebu Ode", "Ikenne", "Imeko Afon", "Ipokia", "Obafemi Owode", "Odeda", "Odogbolu", "Ogun Waterside", "Remo North", "Sagamu", "Shagamu", "Yewa North", "Yewa South"]
  },
  {
    name: "Ondo",
    code: "ON",
    capital: "Akure",
    lgAs: ["Akoko North-East", "Akoko North-West", "Akoko South-East", "Akoko South-West", "Akure North", "Akure South", "Ese Odo", "Idanre", "Ifedore", "Ilaje", "Ile Oluji-Okeigbo", "Irele", "Odigbo", "Okitipupa", "Ondo East", "Ondo West", "Ose", "Owo"]
  },
  {
    name: "Osun",
    code: "OS",
    capital: "Oshogbo",
    lgAs: ["Aiyedaade", "Aiyedire", "Atakunmosa East", "Atakunmosa West", "Boluwaduro", "Boripe", "Ede North", "Ede South", "Egbedore", "Ejigbo", "Ife Central", "Ife East", "Ife North", "Ife South", "Ifedayo", "Ifelodun (Osun)", "Ila", "Ilesa East", "Ilesa West", "Irepodun (Osun)", "Irewole", "Isokan", "Iwo", "Obokun", "Odo Otin", "Ola Oluwa", "Olorunda", "Oriade", "Orolu", "Osogbo"]
  },
  {
    name: "Oyo",
    code: "OY",
    capital: "Ibadan",
    lgAs: ["Afijio", "Akinyele", "Atiba", "Atisbo", "Egbeda", "Ibadan North", "Ibadan North-East", "Ibadan North-West", "Ibadan South-East", "Ibadan South-West", "Ibarapa Central", "Ibarapa East", "Ibarapa North", "Ido", "Irepo", "Iseyin", "Itesiwaju", "Iwajowa", "Kajola", "Lagelu", "Ogbomosho North", "Ogbomosho South", "Ogo Oluwa", "Olorunsogo", "Oluyole", "Ona Ara", "Orelope", "Ori Ire", "Oyo East", "Oyo West", "Saki East", "Saki West", "Surulere (Oyo)"]
  },
  {
    name: "Plateau",
    code: "PL",
    capital: "Jos",
    lgAs: ["Barkin Ladi", "Bassa (Plateau)", "Bokkos", "Jos East", "Jos North", "Jos South", "Kanam", "Kanke", "Langtang North", "Langtang South", "Mangu", "Mikang", "Pankshin", "Qua'an Pan", "Riyom", "Shendam", "Wase"]
  },
  {
    name: "Rivers",
    code: "RI",
    capital: "Port Harcourt",
    lgAs: ["Abua Odual", "Ahoada East", "Ahoada West", "Akuku Toru", "Andoni", "Asari-Toru", "Bonny", "Degema", "Eleme", "Emohua", "Etche", "Gokana", "Ikwerre", "Khana", "Obio Akpor", "Ogba Egbema Ndoni", "Ogu Bolo", "Okrika", "Omuma", "Opobo Nkoro", "Oyigbo", "Port Harcourt", "Tai"]
  },
  {
    name: "Sokoto",
    code: "SO",
    capital: "Sokoto",
    lgAs: ["Binji", "Bodinga", "Dange Shuni", "Gada", "Goronyo", "Gudu", "Gwadabawa", "Illela", "Isa", "Kebbe", "Kware", "Rabah", "Sabon Birni", "Shagari", "Silame", "Sokoto North", "Sokoto South", "Tambuwal", "Tangaza", "Tureta", "Wamako", "Wurno", "Yabo"]
  },
  {
    name: "Taraba",
    code: "TA",
    capital: "Jalingo",
    lgAs: ["Ardo Kola", "Bali", "Donga", "Gashaka", "Gassol", "Ibi", "Jalingo", "Karim Lamido", "Kumi", "Lau", "Sardauna", "Takum", "Ussa", "Wukari", "Yorro", "Zing"]
  },
  {
    name: "Yobe",
    code: "YO",
    capital: "Damaturu",
    lgAs: ["Bade", "Bursari", "Damaturu", "Fika", "Fune", "Geidam", "Gujba", "Gulani", "Jakusko", "Karasuwa", "Machina", "Nangere", "Nguru", "Potiskum", "Tarmuwa", "Yunusari", "Yusufari"]
  },
  {
    name: "Zamfara",
    code: "ZA",
    capital: "Gusau",
    lgAs: ["Anka", "Bakura", "Birnin Magaji Kiyaw", "Bukkuyum", "Bungudu", "Gummi", "Gusau", "Kaura Namoda", "Maradun", "Maru", "Shinkafi", "Talata Mafara", "Tsafe", "Zurmi"]
  }
];

// Helper functions
export function getStateByName(name: string): StateData | undefined {
  return NIGERIA_STATES.find(s => s.name.toLowerCase() === name.toLowerCase());
}

export function getLGAsForState(stateName: string): string[] {
  const state = getStateByName(stateName);
  return state?.lgAs || [];
}

export function getStateNames(): string[] {
  return NIGERIA_STATES.map(s => s.name).sort();
}

// Major cities for quick select (used in property forms)
export const MAJOR_CITIES = [
  "Lagos", "Abuja", "Ibadan", "Port Harcourt", "Kano", "Benin City",
  "Kaduna", "Enugu", "Owerri", "Uyo", "Abeokuta", "Onitsha", "Calabar",
  "Jos", "Warri", "Ilorin", "Osogbo", "Aba", "Maiduguri", "Sokoto"
];
