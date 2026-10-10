// Transparent, receipt-item-based suggestions. Never invent a specific event or business reason.
export function suggestExpense(receipt){
 const text=(receipt.lineItems||[]).map(x=>x.description||'').join(' ').toLowerCase();
 const rules=[
  [/balloon|pump|decorat|banner|party|craft|stationery|paper|pen|marker/, 'Office supplies','Purchased supplies for an organizational activity; confirm the specific activity.'],
  [/tyre|tire|wheel balanc|alignment|car service|vehicle repair|engine oil|brake pad/, 'Vehicle maintenance','Vehicle maintenance expense; confirm that the vehicle was used for authorized work.'],
  [/petrol|diesel|fuel|toll|parking|taxi|grab|bus|train/, 'Travel','Transport-related expense; confirm the work-related journey.'],
  [/hotel|lodging|room night|accommodation/, 'Accommodation','Accommodation expense; confirm the business trip or event.'],
  [/coffee|tea|milk|rice|chicken|meal|food|restaurant|lunch|dinner|burger/, 'Meals','Food or refreshments purchased; confirm the business purpose and attendees.'],
 ];
 const found=rules.find(([regex])=>regex.test(text));
 return {category:found?.[1]||'Other',purpose:found?.[2]||'Expense recorded from receipt; describe the actual work-related reason.',source:found?'receipt item keywords':'no matching item keywords',needsConfirmation:true};
}
