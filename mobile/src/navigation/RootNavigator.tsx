import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ConnectedPodProvider } from '../context/ConnectedPodContext';
import LoginScreen from '../screens/LoginScreen';
import TrainingListScreen from '../screens/TrainingListScreen';
import TrainingSetupScreen from '../screens/TrainingSetupScreen';
import DeviceScanScreen from '../screens/DeviceScanScreen';
import TrainingSessionScreen from '../screens/TrainingSessionScreen';
import TrainingResultScreen from '../screens/TrainingResultScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <ConnectedPodProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="TrainingList"
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0A0A0A' },
          }}
        >
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="TrainingList" component={TrainingListScreen} />
          <Stack.Screen name="TrainingSetup" component={TrainingSetupScreen} />
          <Stack.Screen name="DeviceScan" component={DeviceScanScreen} />
          <Stack.Screen name="TrainingSession" component={TrainingSessionScreen} />
          <Stack.Screen name="TrainingResult" component={TrainingResultScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </ConnectedPodProvider>
  );
}
