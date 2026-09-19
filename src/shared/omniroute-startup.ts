/** Next can keep listening after fatal instrumentation failure. Health polling
 * must surface that failure instead of waiting for the entire boot deadline. */
export function omnirouteStartupFailure(output: string): string | undefined {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, '')
  return clean.split(/\r?\n/).find((line) =>
    /(?:An error occurred while loading instrumentation hook|Error: (?:Cannot find module|Failed to load external module|listen EADDRINUSE)|SyntaxError:)/i.test(line)
  )?.trim()
}
