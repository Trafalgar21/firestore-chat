// @refresh reset

import React, { useEffect, useState, useCallback } from 'react'
import { View, Platform } from 'react-native'
// import { View, KeyboardAvoidingView, Platform } from 'react-native'
import PropTypes from 'prop-types'

import { Ionicons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'

import AsyncStorage from '@react-native-community/async-storage'
import { GiftedChat, Actions } from 'react-native-gifted-chat'
import { firestore, getTimestamp } from '../../firebase/firebase.app'
import {
  registerToPushNotification,
  sendPushNotifications,
  pickFromLibrary,
  upload,
} from '../../utils'

import { v4 as uuidV4 } from 'uuid'

const chatsRef = firestore.collection('chats')
const expoPushTokensRef = firestore.collection('expoPushTokens')

const ChatScreen = (props) => {
  const [messages, setMessages] = useState([])
  const [expoPushToken, setExpoPushToken] = useState()
  const [participantTokens, setParticipantTokens] = useState()

  const user = props.userData

  useEffect(() => {
    getExpoNotifToken()

    const unsubscribe = chatsRef.onSnapshot((querySnapshot) => {
      const messagesFirestore = querySnapshot
        .docChanges()
        .filter(({ type }) => type === 'added')
        .map(({ doc }) => {
          const message = doc.data()
          // `createdAt` is firebase.firestore.Timestamp instance
          // https://firebase.google.com/docs/reference/js/firebase.firestore.Timestamp
          return { ...message, createdAt: message.createdAt.toDate() }
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

      // Render messages
      appendMessages(messagesFirestore)
    })

    // Stop listening for updates when no longer required
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const unsubscribe = expoPushTokensRef.onSnapshot((querySnapshot) => {
      const otherTokens = querySnapshot
        .docChanges()
        .filter(({ doc }) => doc.data().token !== expoPushToken)
        .map(({ doc }) => doc.data().token)

      setParticipantTokens(otherTokens)
    })

    return () => unsubscribe()
  }, [])

  const appendMessages = useCallback(
    (messages) => {
      setMessages((previousMessages) =>
        GiftedChat.append(previousMessages, messages)
      )
    },
    [messages]
  )

  async function getExpoNotifToken() {
    let token = await AsyncStorage.getItem('expoPushToken')

    if (!token) {
      registerToPushNotification().then((response) => {
        if (!response) return

        token = response

        // NOTE: We separated the tokens to another collection instead of using the 'users' collection.
        // This is to flatten data and avoid expensive queries when notifying multiple devices.
        expoPushTokensRef.doc(user._id).set({ token })

        AsyncStorage.setItem('expoPushToken', token)
      })
    }

    setExpoPushToken(token)
  }

  async function handleSend(messages) {
    const writes = messages.map((m) => chatsRef.doc(m._id).set(m)) // Can be chatsRef.add(m)) but using it auto generates the document id.

    await Promise.all(writes)

    const notif = {
      title: user.name.trim() + 'sent a message!',
      body: (messages[0].text || '...').slice(0, 49), // Android standard max length for notifs is 49 characters
    }
    await sendPushNotifications(notif, participantTokens)
  }

  async function pickFromGallery() {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestCameraRollPermissionsAsync()
      if (status !== 'granted') {
        alert('Sorry, we need camera roll permissions to make this work!')
        return
      }
    }

    const { uri, cancelled } = await pickFromLibrary()

    !cancelled && uri && uploadImage(uri)
  }

  function uploadImage(uri) {
    upload(uri, uuidV4()).then(async (uploadTaskSnapshot) => {
      const downloadURL = await uploadTaskSnapshot.ref.getDownloadURL()

      handleSend([
        {
          _id: uuidV4(),
          createdAt: getTimestamp(),
          user,
          image: downloadURL,
        },
      ])
    })
    // KEEP 🔍
    // UploadTask.on('state_changed', ({ bytesTransferred, totalBytes }) => {
    //   // Upload progress
    //   console.info(`${bytesTransferred} transferred out of ${totalBytes}`)
    // })
  }

  async function useCamera() {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync()
      if (status !== 'granted') {
        alert('Sorry, we need camera permissions to make this work!')
        return
      }
    }

    const { uri, cancelled } = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
    })

    !cancelled && uri && uploadImage(uri)
  }

  const renderActions = (props) => {
    return (
      <>
        <Actions
          {...props}
          onPressActionButton={pickFromGallery}
          icon={() => <Ionicons name='md-photos' size={32} color='#737373' />}
        />
        <Actions
          {...props}
          onPressActionButton={useCamera}
          icon={() => <Ionicons name='md-camera' size={32} color='#737373' />}
        />
      </>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <GiftedChat
        messages={messages}
        user={user}
        onSend={handleSend}
        renderActions={renderActions}
      />
      {/* {Platform.OS === 'android' && <KeyboardAvoidingView behavior='padding' />} */}
    </View>
  )
}

ChatScreen.propTypes = {
  userData: PropTypes.shape({
    _id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
  }).isRequired,
}

export default ChatScreen
