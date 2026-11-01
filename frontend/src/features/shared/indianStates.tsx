/** States and union territories of India, offered as suggestions (the field stays free text). */
export const INDIAN_STATES: readonly string[] = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
];

/** `<datalist>` for a state input: `<Input list={id} />` + `<StateSuggestions id={id} />`. */
export function StateSuggestions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      {INDIAN_STATES.map((state) => (
        <option key={state} value={state} />
      ))}
    </datalist>
  );
}
