// Describe existing workflows accurately; permissions and billing stay on the server.
export const WORKER_PRO_TOOLS = [
  ['Work insights', 'Completed jobs, released earnings, ratings, repeat customers and cancellations.'],
  ['Work schedule', 'See confirmed and ongoing WeHouse jobs together; normal job management stays available without Pro.'],
  ['Calendar export', 'Download a calendar snapshot of your scheduled work.'],
  ['Job reminders', 'See due reminders while the business-tools screen is open.'],
  ['Returning customers', 'See completed-job history for customers who consented to a record.'],
  ['Private customer notes', 'Keep notes for consenting customers and remove them when consent ends.'],
  ['Service package records', 'Describe starting-price packages on your profile; they are not checkout offers.'],
  ['Quotes and invoice drafts', 'Prepare itemized job documents and download PDFs with clear payment labels.'],
  ['Branded service receipts', 'Download branded PDFs for released jobs with optional aftercare notes; normal payment records do not require Pro.'],
  ['Job costs and net earnings', 'Record costs and compare them with released earnings.'],
  ['Earnings and cost exports', 'Download CSV reports for your own records.'],
  ['Featured profile work', 'Choose work to feature on your own profile from Showcase; this does not improve search ranking.'],
] as const;

export const PARTNER_PRO_TOOLS = [
  ['Portfolio overview', 'See owned homes and hotels in one workspace.'],
  ['Property filters', 'Focus calendar and task views on one owned place.'],
  ['Stay calendar', 'Review eligible confirmed or paid stays across your portfolio.'],
  ['Calendar export', 'Download a snapshot; it does not sync or block availability.'],
  ['Released-income overview', 'See the last twelve months of released net earnings.'],
  ['Monthly income breakdown', 'Review the value and number of earning entries by month.'],
  ['Income CSV', 'Export monthly released-income figures.'],
  ['Statement PDF', 'Download an operational earnings statement, separate from a bank payout receipt.'],
  ['Maintenance and turnover tasks', 'Keep property work with the place it belongs to.'],
  ['Repeating tasks', 'Complete a recurring task to create its next dated occurrence.'],
  ['Occupancy view', 'Compare booked unit nights with listed capacity over the next thirty days.'],
  ['Property operating costs', 'Record cleaning, repairs, utilities and other costs against owned properties.'],
  ['Recorded operating margin', 'Compare released WeHouse income with recorded costs by month and property; this is not a tax-profit or bank-balance figure.'],
  ['Cost record export and correction', 'Export the costs shown and void mistaken records with a retained reason and history.'],
] as const;
