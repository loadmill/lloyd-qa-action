export function parseInstructions(contents) {
  return contents
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "").trim())
    .filter(Boolean);
}

export function createProgressParser({instructions, publish}) {
  let currentInstruction = null;
  let lastInstructionIndex = -1;

  function line(rawLine) {
    const value = rawLine.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").trim();
    if (value.includes("Provisioning Loadmill Cloud device")) {
      publish("provisioning");
    } else if (value.startsWith("Connected to Loadmill Cloud device")) {
      publish("connected", {total: instructions.length});
    } else if (
      value === "Test completed successfully." ||
      value === "Ending Loadmill Cloud session..."
    ) {
      publish("collecting_results", {
        current: instructions.length,
        total: instructions.length,
      });
    }

    const index = instructions.indexOf(value, lastInstructionIndex + 1);
    if (index >= 0) {
      lastInstructionIndex = index;
      currentInstruction = {
        current: index + 1,
        total: instructions.length,
        instruction: instructions[index],
      };
      publish("running_instruction", currentInstruction);
    }
  }

  return {
    line,
    result(exitCode) {
      return {
        totalInstructions: instructions.length,
        completedInstructions:
          exitCode === 0 ? instructions.length : Math.max(0, lastInstructionIndex),
        currentInstruction,
      };
    },
  };
}
