module.exports = {
	initVariables() {
		let self = this
		let variables = []

		variables.push({ variableId: `destination`, name: `Selected Destination` })
		variables.push({ variableId: `destination_name`, name: `Selected Destination Name` })

		self.setVariableDefinitions(variables)
	},
}
