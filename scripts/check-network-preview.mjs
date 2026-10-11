// Validates evidence measured in a real browser. Does not drive or simulate one.
export function checkNetworkPreview({locale,width,scrollWidth,viewportWidth,brokenLinks,consoleErrors,focusChecks}) {
  const violations=[];
  if (!['zh','en'].includes(locale)) violations.push('locale missing');
  if (![width,scrollWidth,viewportWidth].every(Number.isFinite) || width<=0 || viewportWidth!==width) violations.push('viewport measurement missing or mismatched');
  if (scrollWidth>viewportWidth) violations.push('horizontal overflow');
  if (!Array.isArray(brokenLinks)||brokenLinks.length) violations.push('broken or unverified links');
  if (!Array.isArray(consoleErrors)||consoleErrors.length) violations.push('console errors or missing capture');
  if (focusChecks?.pass!==true) violations.push('focus checks incomplete');
  return {ok:violations.length===0,violations};
}
