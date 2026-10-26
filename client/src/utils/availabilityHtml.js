export function cleanAvailability(availability) {
  return String(availability || '').replace(/<[^>]*>/g, '').trim();
}

export function getAvailabilityBodyColor() {
  return '#64748b';
}
