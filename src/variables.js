module.exports = {
	initVariables() {
		let self = this
		let variables = []

		variables.push({ variableId: `destination`, name: `Selected Destination` })
		variables.push({ variableId: `destination_name`, name: `Selected Destination Name` })
		variables.push({ variableId: `dst`, name: `Selected Destination for Take` })		
		variables.push({ variableId: `src`, name: `Selected Source Name` })

		self.setVariableDefinitions(variables)
	},
}
