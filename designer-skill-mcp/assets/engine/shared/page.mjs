import { stripHtmlComments } from './text.mjs';

/** Check if content looks like a full page (not a component/partial) */
function isFullPage(content) {
  return /<!doctype\s|<html[\s>]|<head[\s>]/i.test(stripHtmlComments(content, ''));
}

export { isFullPage };
