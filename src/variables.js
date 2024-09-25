module.exports = {
	initVariables() {
		let self = this
		let variables = []

		variables.push({ variableId: `destination`, name: `Selected Destination` })

		self.setVariableDefinitions(variables)
	},
}
